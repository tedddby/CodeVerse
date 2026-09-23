import type { Node } from "web-tree-sitter";
import type { ImportKind, SymbolKind } from "@/graph/model/types";
import type { Extraction } from "@/parser/languages/types";
import type { ParsedImport, ParsedSymbol } from "@/parser/types";
import { endLine, startLine } from "./nodes";

/**
 * How a symbol's `exported` flag is decided:
 * - "exported" / "hidden": fixed by the declaration itself;
 * - "inherit": exported exactly when its parent symbol is (public class
 *   members, members of ambient namespaces, Rust trait items).
 */
export type Visibility = "exported" | "hidden" | "inherit";

/**
 * Export list derived from visibility rules (Python without `__all__`, Java,
 * Go, Rust): names of exported top-level symbols, methods excluded, first
 * occurrence first.
 */
export function topLevelExportNames(symbols: readonly ParsedSymbol[]): string[] {
  const names = new Set<string>();
  for (const symbol of symbols) {
    if (symbol.parentIndex === undefined && symbol.exported && symbol.kind !== "method") {
      names.add(symbol.name);
    }
  }
  return [...names];
}

export interface SymbolInput {
  name: string;
  kind: SymbolKind;
  /** Node spanning the declaration's full line range (including decorators/export keyword). */
  range: Node;
  /** Earlier node where the range starts instead (decorators stored as preceding siblings). */
  rangeStart?: Node;
  visibility: Visibility;
  parentIndex?: number;
  signature?: string;
  /**
   * Keep the symbol only if it ends up exported (plain variables that are
   * interesting only when a later `export { name }` makes them public API).
   * Such symbols must not become parents.
   */
  dropUnlessExported?: boolean;
}

interface SymbolRecord {
  symbol: ParsedSymbol;
  visibility: Visibility;
  dropUnlessExported: boolean;
}

interface ImportRecord {
  entry: ParsedImport;
  order: number;
}

/**
 * Accumulates extraction output and applies the cross-cutting rules once the
 * whole tree has been seen: late visibility changes (`export { a }`,
 * `__all__`), inherited visibility, dropping of noise symbols, import order.
 */
export class ExtractionBuilder {
  private readonly records: SymbolRecord[] = [];
  private readonly importRecords: ImportRecord[] = [];
  private readonly exportNames = new Set<string>();
  private readonly lateExports = new Set<string>();
  private topLevelVisibility: ((name: string) => boolean) | null = null;
  packageName: string | undefined;

  /** Adds a symbol and returns its index (usable as `parentIndex` for members). */
  addSymbol(input: SymbolInput): number {
    const symbol: ParsedSymbol = {
      name: input.name,
      kind: input.kind,
      startLine: startLine(input.rangeStart ?? input.range),
      endLine: endLine(input.range),
      exported: input.visibility === "exported",
    };
    if (input.parentIndex !== undefined) symbol.parentIndex = input.parentIndex;
    if (input.signature) symbol.signature = input.signature;
    this.records.push({
      symbol,
      visibility: input.visibility,
      dropUnlessExported: input.dropUnlessExported ?? false,
    });
    return this.records.length - 1;
  }

  /** Read access to an added symbol (e.g. to resolve Go/Rust receivers by name). */
  symbolAt(index: number): Readonly<ParsedSymbol> | undefined {
    return this.records[index]?.symbol;
  }

  setParent(index: number, parentIndex: number): void {
    const record = this.records[index];
    if (record && index !== parentIndex) record.symbol.parentIndex = parentIndex;
  }

  /** Marks top-level symbols named `name` as exported once extraction completes. */
  exportLocal(name: string): void {
    this.lateExports.add(name);
  }

  /**
   * Replaces the visibility of every top-level symbol with `isExported(name)`
   * (Python's `__all__`). Applied before inherited visibility is resolved.
   */
  overrideTopLevelVisibility(isExported: (name: string) => boolean): void {
    this.topLevelVisibility = isExported;
  }

  addImport(input: { specifier: string; kind: ImportKind; node: Node; names?: string[] }): void {
    if (input.specifier.length === 0) return;
    const entry: ParsedImport = {
      specifier: input.specifier,
      kind: input.kind,
      line: startLine(input.node),
    };
    if (input.names && input.names.length > 0) entry.names = input.names;
    this.importRecords.push({ entry, order: this.importRecords.length });
  }

  /** Adds a name to the module's export list (deduplicated, first occurrence wins). */
  addExport(name: string): void {
    if (name.length > 0) this.exportNames.add(name);
  }

  build(): Extraction {
    this.applyTopLevelVisibility();
    this.resolveInheritedVisibility();
    const symbols = this.dropNoise();
    const imports = [...this.importRecords]
      .sort((a, b) => a.entry.line - b.entry.line || a.order - b.order)
      .map((record) => record.entry);
    const extraction: Extraction = { symbols, imports, exports: [...this.exportNames] };
    if (this.packageName) extraction.packageName = this.packageName;
    return extraction;
  }

  private applyTopLevelVisibility(): void {
    for (const record of this.records) {
      if (record.symbol.parentIndex !== undefined) continue;
      if (this.topLevelVisibility) {
        record.visibility = this.topLevelVisibility(record.symbol.name) ? "exported" : "hidden";
      }
      if (this.lateExports.has(record.symbol.name)) record.visibility = "exported";
      if (record.visibility !== "inherit")
        record.symbol.exported = record.visibility === "exported";
    }
  }

  private resolveInheritedVisibility(): void {
    const resolved = new Map<number, boolean>();
    const resolve = (start: number): boolean => {
      // Walk up iteratively; parents may be declared after children (Go/Rust receivers).
      const chain: number[] = [];
      let index: number | undefined = start;
      let value = false;
      while (index !== undefined) {
        const known = resolved.get(index);
        if (known !== undefined) {
          value = known;
          break;
        }
        const record: SymbolRecord | undefined = this.records[index];
        if (!record || chain.includes(index)) break;
        if (record.visibility !== "inherit") {
          value = record.visibility === "exported";
          resolved.set(index, value);
          break;
        }
        chain.push(index);
        index = record.symbol.parentIndex;
      }
      for (const member of chain) resolved.set(member, value);
      return value;
    };
    this.records.forEach((record, index) => {
      record.symbol.exported = resolve(index);
    });
  }

  private dropNoise(): ParsedSymbol[] {
    const remap = new Map<number, number>();
    const kept: ParsedSymbol[] = [];
    this.records.forEach((record, index) => {
      if (record.dropUnlessExported && !record.symbol.exported) return;
      remap.set(index, kept.length);
      kept.push(record.symbol);
    });
    for (const symbol of kept) {
      if (symbol.parentIndex === undefined) continue;
      const parent = remap.get(symbol.parentIndex);
      if (parent === undefined) delete symbol.parentIndex;
      else symbol.parentIndex = parent;
    }
    return kept;
  }
}
