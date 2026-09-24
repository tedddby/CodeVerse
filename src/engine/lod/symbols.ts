import type { Vec3Like } from "./projection";

/**
 * Symbol-band level of detail. Bands (classes, functions, ... as floors on a
 * building) only make sense up close, so they are computed lazily for the
 * selected building plus a small, bounded set of buildings near the camera.
 */

export const SYMBOL_BUILDING_BUDGET = 30;
export const SYMBOL_LABEL_BUDGET = 25;
/** A building is "near" when the camera is within this many building sizes. */
export const SYMBOL_DISTANCE_FACTOR = 6;

export interface BandBuildingCandidate {
  id: string;
  x: number;
  z: number;
  baseY: number;
  width: number;
  depth: number;
  height: number;
}

export interface SymbolBuildingOptions {
  camera: Vec3Like;
  /** Always included first when it has symbols. */
  selectedFileId: string | null;
  hasSymbols: (fileId: string) => boolean;
  budget?: number;
  distanceFactor?: number;
  /** Optional frustum test on the building's bounding sphere. */
  isVisible?: (candidate: BandBuildingCandidate, radius: number) => boolean;
}

/**
 * Buildings that should show symbol bands, nearest (relative to their own
 * size) first. Deterministic for identical inputs.
 */
export function selectSymbolBuildings(
  buildings: Iterable<BandBuildingCandidate>,
  options: SymbolBuildingOptions,
): string[] {
  const budget = Math.max(
    0,
    Math.min(options.budget ?? SYMBOL_BUILDING_BUDGET, SYMBOL_BUILDING_BUDGET),
  );
  const factor = options.distanceFactor ?? SYMBOL_DISTANCE_FACTOR;
  const picked: string[] = [];
  const selected = options.selectedFileId;
  if (selected && budget > 0 && options.hasSymbols(selected)) picked.push(selected);

  const near: Array<{ id: string; ratio: number }> = [];
  for (const building of buildings) {
    if (building.id === selected) continue;
    const size = Math.max(building.width, building.depth, building.height);
    if (size <= 0) continue;
    const cx = building.x - options.camera.x;
    const cy = building.baseY + building.height / 2 - options.camera.y;
    const cz = building.z - options.camera.z;
    const distance = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const ratio = distance / size;
    // Cheap distance test first: most of a large city is far away.
    if (ratio > factor || !options.hasSymbols(building.id)) continue;
    const radius = Math.hypot(building.width, building.depth, building.height) / 2;
    if (options.isVisible && !options.isVisible(building, radius)) continue;
    near.push({ id: building.id, ratio });
  }
  near.sort((a, b) => a.ratio - b.ratio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const entry of near) {
    if (picked.length >= budget) break;
    picked.push(entry.id);
  }
  return picked;
}

export interface BandSpan {
  id: string;
  y0: number;
  y1: number;
}

/**
 * Chooses which bands of a building get a text label: largest bands first,
 * skipping any whose centre is closer than `minSpacing` to an already chosen
 * label (so labels never stack on top of each other). `pinnedId` (the
 * selected symbol) claims its place first. Returned in bottom-to-top order.
 */
export function selectSymbolLabels(
  bands: readonly BandSpan[],
  minSpacing: number,
  budget = SYMBOL_LABEL_BUDGET,
  pinnedId: string | null = null,
): BandSpan[] {
  const limit = Math.max(0, Math.min(budget, SYMBOL_LABEL_BUDGET));
  const bySize = [...bands].sort(
    (a, b) =>
      b.y1 - b.y0 - (a.y1 - a.y0) || a.y0 - b.y0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const pinned = pinnedId === null ? undefined : bands.find((band) => band.id === pinnedId);
  const chosen: BandSpan[] = pinned && limit > 0 ? [pinned] : [];
  for (const band of bySize) {
    if (chosen.length >= limit) break;
    if (band === pinned) continue;
    const mid = (band.y0 + band.y1) / 2;
    const clashes = chosen.some((other) => Math.abs((other.y0 + other.y1) / 2 - mid) < minSpacing);
    if (!clashes) chosen.push(band);
  }
  return chosen.sort((a, b) => a.y0 - b.y0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Band spans measured on screen: each band's vertical range, projected along
 * the building's axis by `projectY` (world height -> screen y, or null when
 * it does not project), as a pixel span. Feeding these to
 * `selectSymbolLabels` with a pixel spacing keeps labels apart at any
 * pitch: a vertical world gap shrinks on screen as the view steepens (with
 * the sine of the polar angle) and vanishes top-down, where only one label
 * fits. Bands that do not project are dropped.
 */
export function screenBandSpans(
  bands: readonly BandSpan[],
  projectY: (worldY: number) => number | null,
): BandSpan[] {
  const spans: BandSpan[] = [];
  for (const band of bands) {
    const a = projectY(band.y0);
    const b = projectY(band.y1);
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    spans.push({ id: band.id, y0: Math.min(a, b), y1: Math.max(a, b) });
  }
  return spans;
}
