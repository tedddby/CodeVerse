import type { FileNode } from "@/graph/model/types";
import { finiteNonNegative } from "./geometry";
import type { LayoutOptions } from "./types";

/**
 * Visual encodings of a single file:
 * - footprint (side length of the square building) encodes bytes;
 * - height encodes lines of code.
 *
 * Both are pure functions of the file and the options so the renderer, the
 * minimap and tests can reproduce exactly what the layout engine used.
 */

/**
 * Bytes at which the footprint reaches `maxFootprint`. Below it the side grows
 * with sqrt(bytes), i.e. the building's ground area grows linearly with size.
 */
export const FOOTPRINT_REFERENCE_BYTES = 64 * 1024;

/**
 * Lines of code at which a building reaches half of the height range.
 * Height follows sqrt(lines) / (sqrt(lines) + sqrt(HEIGHT_HALF_RANGE_LINES)):
 * sqrt keeps 100 vs 1,000 lines clearly distinguishable (about 2x), and the
 * saturating denominator keeps a 50k-line file from dwarfing the skyline
 * (it never exceeds `maxHeight`, yet stays strictly taller than a 10k-line file).
 */
export const HEIGHT_HALF_RANGE_LINES = 1_500;

const HEIGHT_HALF_RANGE_ROOT = Math.sqrt(HEIGHT_HALF_RANGE_LINES);

/** Side length of the building's square footprint, from the file size in bytes. */
export function buildingFootprint(file: Pick<FileNode, "size">, options: LayoutOptions): number {
  const size = Math.min(finiteNonNegative(file.size), FOOTPRINT_REFERENCE_BYTES);
  const t = Math.sqrt(size / FOOTPRINT_REFERENCE_BYTES);
  return options.minFootprint + (options.maxFootprint - options.minFootprint) * t;
}

/**
 * Building height from lines of code. Binary files and files without lines get
 * `minHeight` (a flat plot), so they stay visible without pretending to hold code.
 * Estimated line counts use the same scale as exact ones.
 */
export function buildingHeight(
  file: Pick<FileNode, "lines" | "status">,
  options: LayoutOptions,
): number {
  const lines = finiteNonNegative(file.lines);
  if (lines === 0 || file.status === "binary") return options.minHeight;
  const root = Math.sqrt(lines);
  const t = root / (root + HEIGHT_HALF_RANGE_ROOT);
  return options.minHeight + (options.maxHeight - options.minHeight) * t;
}
