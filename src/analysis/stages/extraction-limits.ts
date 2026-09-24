import type { ParseResult, ParsedSymbol } from "@/parser/types";

/**
 * Caps on what parse results may add to one graph. Extraction is otherwise
 * unbounded: a crafted repository of 256 KiB files with ten thousand one-line
 * functions each inflates the graph far beyond what the server caches or a
 * browser can load. Real code stays well below these caps (the whole
 * facebook/react graph has fewer than 10,000 symbols).
 */

export const MAX_SYMBOLS_PER_FILE = 2_000;
export const MAX_IMPORTS_PER_FILE = 1_000;
export const MAX_EXPORTS_PER_FILE = 2_000;
export const MAX_GRAPH_SYMBOLS = 100_000;
export const MAX_GRAPH_IMPORTS = 200_000;
export const MAX_GRAPH_EXPORTS = 100_000;

/** Longest parent chain followed when ranking symbols by nesting depth. */
const MAX_NESTING = 64;

/** What the rest of the graph may still take; files are charged in parse order. */
export interface ExtractionBudget {
  symbols: number;
  imports: number;
  exports: number;
}

export function createExtractionBudget(): ExtractionBudget {
  return { symbols: MAX_GRAPH_SYMBOLS, imports: MAX_GRAPH_IMPORTS, exports: MAX_GRAPH_EXPORTS };
}

export interface CappedExtraction {
  parse: ParseResult;
  /** Items dropped by the caps (0 when the parse was kept whole). */
  droppedSymbols: number;
  droppedImports: number;
  droppedExports: number;
}

/** Nesting depth of every symbol (0 = top level); broken or cyclic parent links count as top level. */
function nestingDepths(symbols: readonly ParsedSymbol[]): number[] {
  return symbols.map((symbol) => {
    let depth = 0;
    let parent = symbol.parentIndex;
    while (parent !== undefined && depth < MAX_NESTING) {
      const next = symbols[parent];
      if (!next) break;
      depth += 1;
      parent = next.parentIndex;
    }
    return depth < MAX_NESTING ? depth : 0;
  });
}

/**
 * Keeps at most `allowance` symbols: shallower symbols first (top-level
 * declarations before methods), in source order within a depth, so a kept
 * symbol's parent is always kept too. Parent indices are remapped.
 */
function capSymbols(symbols: readonly ParsedSymbol[], allowance: number): ParsedSymbol[] {
  if (symbols.length <= allowance) return [...symbols];
  const depths = nestingDepths(symbols);
  const kept = new Set(
    symbols
      .map((_, index) => index)
      .sort((a, b) => (depths[a] ?? 0) - (depths[b] ?? 0) || a - b)
      .slice(0, Math.max(0, allowance)),
  );
  const newIndex = new Map<number, number>();
  const result: ParsedSymbol[] = [];
  symbols.forEach((symbol, index) => {
    if (!kept.has(index)) return;
    newIndex.set(index, result.length);
    result.push({ ...symbol });
  });
  for (const symbol of result) {
    if (symbol.parentIndex === undefined) continue;
    const parent = newIndex.get(symbol.parentIndex);
    if (parent === undefined) delete symbol.parentIndex;
    else symbol.parentIndex = parent;
  }
  return result;
}

/**
 * Applies the per-file caps and what is left of the graph-wide `budget`
 * (which is charged for what the file keeps). The parse is returned unchanged
 * when nothing had to be dropped.
 */
export function capExtraction(parse: ParseResult, budget: ExtractionBudget): CappedExtraction {
  const symbolAllowance = Math.max(0, Math.min(MAX_SYMBOLS_PER_FILE, budget.symbols));
  const importAllowance = Math.max(0, Math.min(MAX_IMPORTS_PER_FILE, budget.imports));
  const exportAllowance = Math.max(0, Math.min(MAX_EXPORTS_PER_FILE, budget.exports));
  const droppedSymbols = Math.max(0, parse.symbols.length - symbolAllowance);
  const droppedImports = Math.max(0, parse.imports.length - importAllowance);
  const droppedExports = Math.max(0, parse.exports.length - exportAllowance);

  let capped = parse;
  if (droppedSymbols + droppedImports + droppedExports > 0) {
    capped = {
      ...parse,
      symbols: droppedSymbols > 0 ? capSymbols(parse.symbols, symbolAllowance) : parse.symbols,
      imports: droppedImports > 0 ? parse.imports.slice(0, importAllowance) : parse.imports,
      exports: droppedExports > 0 ? parse.exports.slice(0, exportAllowance) : parse.exports,
    };
  }
  budget.symbols -= capped.symbols.length;
  budget.imports -= capped.imports.length;
  budget.exports -= capped.exports.length;
  return { parse: capped, droppedSymbols, droppedImports, droppedExports };
}
