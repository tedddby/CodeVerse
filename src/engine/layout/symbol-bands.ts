import type { FileNode, SymbolNode } from "@/graph/model/types";
import { clamp, compareStrings, finiteNonNegative } from "./geometry";
import type { BuildingLayout, SymbolBandLayout } from "./types";

/**
 * Symbol bands: horizontal slices of a building facade, one per symbol.
 *
 * The building is read bottom-up as the file read top-down: line 1 sits at the
 * base, the last line at the roof. A symbol spanning lines [start, end] covers
 *   y0 = baseY + height * (start - 1) / lines
 *   y1 = baseY + height * end / lines
 * Bands thinner than a visible minimum are widened around their centre.
 * Nested symbols (methods inside a class, ...) are clamped inside their parent's
 * band, get depth + 1 and a larger inset, so the nesting reads on the facade.
 */

/** Minimum band thickness as a fraction of the building height... */
const MIN_BAND_FRACTION = 0.015;
/** ...but never thinner than this many world units (unless the building is shorter). */
const MIN_BAND_THICKNESS = 0.08;
/** Inset added per nesting level, as a fraction of the building's smaller side. */
const INSET_STEP_FRACTION = 0.07;
/** Largest inset, as a fraction of the building's smaller side (keeps bands on the facade). */
const MAX_INSET_FRACTION = 0.35;

function toLine(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

/** Deterministic source order: by start line, enclosing symbols first, then id. */
function compareSymbols(a: SymbolNode, b: SymbolNode): number {
  return (
    toLine(a.startLine, 1) - toLine(b.startLine, 1) ||
    toLine(b.endLine, 1) - toLine(a.endLine, 1) ||
    compareStrings(a.id, b.id)
  );
}

/**
 * Nesting depth of every symbol through `parentSymbolId`, following only
 * parents present in `byId`. Parent cycles are cut deterministically: a symbol
 * whose chain loops back is treated as top-level at the point of the loop.
 */
function computeDepths(byId: Map<string, SymbolNode>): Map<string, number> {
  const depths = new Map<string, number>();
  const resolve = (start: SymbolNode): number => {
    const chain: SymbolNode[] = [];
    const seen = new Set<string>();
    let current: SymbolNode | undefined = start;
    let base = -1;
    while (current) {
      const known = depths.get(current.id);
      if (known !== undefined) {
        base = known;
        break;
      }
      if (seen.has(current.id)) break;
      seen.add(current.id);
      chain.push(current);
      current = current.parentSymbolId ? byId.get(current.parentSymbolId) : undefined;
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const symbol = chain[index];
      if (!symbol) continue;
      base += 1;
      depths.set(symbol.id, base);
    }
    return depths.get(start.id) ?? 0;
  };
  for (const symbol of byId.values()) resolve(symbol);
  return depths;
}

/** Widens [y0, y1] to `minimum` around its centre and keeps it inside [low, high]. */
function fitBand(y0: number, y1: number, low: number, high: number, minimum: number) {
  const available = Math.max(0, high - low);
  const thickness = Math.min(available, Math.max(y1 - y0, minimum));
  let start = (y0 + y1) / 2 - thickness / 2;
  start = clamp(start, low, high - thickness);
  return { y0: start, y1: start + thickness };
}

/**
 * Lays out the bands of `symbols` that belong to `file` on `building`.
 * Symbols of other files are ignored. Output is in source order (start line,
 * enclosing symbols before their members); every band lies within
 * [building.baseY, building.baseY + building.height] and within its parent's band.
 */
export function layoutSymbolBands(
  file: Pick<FileNode, "id" | "lines">,
  symbols: readonly SymbolNode[],
  building: Pick<BuildingLayout, "baseY" | "height" | "width" | "depth">,
): SymbolBandLayout[] {
  const own = symbols.filter((symbol) => symbol.fileId === file.id);
  if (own.length === 0 || !(building.height > 0)) return [];

  const byId = new Map<string, SymbolNode>();
  for (const symbol of [...own].sort(compareSymbols)) {
    if (!byId.has(symbol.id)) byId.set(symbol.id, symbol);
  }
  const ordered = [...byId.values()];
  const depths = computeDepths(byId);

  let lines = Math.floor(finiteNonNegative(file.lines));
  for (const symbol of ordered) lines = Math.max(lines, toLine(symbol.endLine, 0));
  lines = Math.max(1, lines);

  const bottom = building.baseY;
  const top = building.baseY + building.height;
  const minimum = Math.min(
    building.height,
    Math.max(building.height * MIN_BAND_FRACTION, MIN_BAND_THICKNESS),
  );
  const side = Math.max(0, Math.min(building.width, building.depth));

  // Parents are laid out before children so a child can be clamped into its parent.
  const byDepth = [...ordered].sort(
    (a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0) || compareSymbols(a, b),
  );
  const bands = new Map<string, SymbolBandLayout>();
  for (const symbol of byDepth) {
    const depth = depths.get(symbol.id) ?? 0;
    const start = clamp(toLine(symbol.startLine, 1), 1, lines);
    const end = clamp(toLine(symbol.endLine, start), start, lines);
    const parent = symbol.parentSymbolId ? bands.get(symbol.parentSymbolId) : undefined;
    const container = parent && parent.depth < depth ? parent : undefined;
    const { y0, y1 } = fitBand(
      bottom + (building.height * (start - 1)) / lines,
      bottom + (building.height * end) / lines,
      container?.y0 ?? bottom,
      container?.y1 ?? top,
      minimum,
    );
    bands.set(symbol.id, {
      id: symbol.id,
      fileId: file.id,
      y0,
      y1,
      inset: side * Math.min(MAX_INSET_FRACTION, depth * INSET_STEP_FRACTION),
      depth,
    });
  }

  const result: SymbolBandLayout[] = [];
  for (const symbol of ordered) {
    const band = bands.get(symbol.id);
    if (band) result.push(band);
  }
  return result;
}
