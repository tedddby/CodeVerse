import type { LayoutLookup } from "@/engine/layout/lookup";
import { layoutSymbolBands } from "@/engine/layout/symbol-bands";
import type { BuildingLayout, SymbolBandLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, SymbolNode } from "@/graph/model/types";

/**
 * Symbol-band data for the renderer: each band joined with its symbol and
 * building, computed lazily per file and cached for one layout + graph.
 */

export interface BandEntry {
  band: SymbolBandLayout;
  symbol: SymbolNode;
  building: BuildingLayout;
}

export class BandCache {
  private readonly cache = new Map<string, BandEntry[]>();

  constructor(
    private readonly index: GraphIndex,
    private readonly lookup: LayoutLookup,
  ) {}

  /** Bands of a file in source order; empty when the file has no symbols or no building. */
  entriesFor(fileId: string): BandEntry[] {
    const cached = this.cache.get(fileId);
    if (cached) return cached;
    const file = this.index.filesById.get(fileId);
    const building = this.lookup.buildingsById.get(fileId);
    let entries: BandEntry[] = [];
    if (file && building && file.symbolIds.length > 0) {
      const symbols = file.symbolIds
        .map((id) => this.index.symbolsById.get(id))
        .filter((symbol): symbol is SymbolNode => symbol !== undefined);
      const byId = new Map(symbols.map((symbol) => [symbol.id, symbol] as const));
      entries = layoutSymbolBands(file, symbols, building).flatMap((band) => {
        const symbol = byId.get(band.id);
        return symbol ? [{ band, symbol, building }] : [];
      });
    }
    this.cache.set(fileId, entries);
    return entries;
  }
}

/** Truncates a symbol name for a label (code points, with an ellipsis). */
export function symbolLabelText(name: string, maxChars = 36): string {
  const chars = Array.from(name);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("")}…` : name;
}

/**
 * What a hit on a symbol band picks. Only the selected file's bands are
 * symbols; the faint context bands on neighbouring buildings stand out from
 * their facades, so a hit on one must act exactly like a hit on its building.
 */
export function bandPickRef(
  symbol: Pick<SymbolNode, "id" | "fileId">,
  selectedFileId: string | null,
): NodeRef {
  return symbol.fileId === selectedFileId
    ? { kind: "symbol", id: symbol.id }
    : { kind: "file", id: symbol.fileId };
}
