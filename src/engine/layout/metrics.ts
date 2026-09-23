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

/**
 * Generated files (lockfiles, bundles, snapshots) are capped at this fraction
 * of the height range: a 6,000-line lockfile says nothing about the code, so it
 * must not become the tallest landmark in the skyline.
 */
export const GENERATED_HEIGHT_FRACTION = 0.12;

/** Side length of the building's square footprint, from the file size in bytes. */
export function buildingFootprint(file: Pick<FileNode, "size">, options: LayoutOptions): number {
  const size = Math.min(finiteNonNegative(file.size), FOOTPRINT_REFERENCE_BYTES);
  const t = Math.sqrt(size / FOOTPRINT_REFERENCE_BYTES);
  return options.minFootprint + (options.maxFootprint - options.minFootprint) * t;
}

/**
 * Building height from lines of code. Binary files and files without lines get
 * `minHeight` (a flat plot), so they stay visible without pretending to hold code.
 * Generated files are capped low (see GENERATED_HEIGHT_FRACTION). Estimated
 * line counts use the same scale as exact ones.
 */
export function buildingHeight(
  file: Pick<FileNode, "lines" | "status"> & Partial<Pick<FileNode, "isGenerated">>,
  options: LayoutOptions,
): number {
  const lines = finiteNonNegative(file.lines);
  if (lines === 0 || file.status === "binary") return options.minHeight;
  const root = Math.sqrt(lines);
  const t = root / (root + HEIGHT_HALF_RANGE_ROOT);
  const range = options.maxHeight - options.minHeight;
  if (file.isGenerated) return options.minHeight + range * Math.min(t, GENERATED_HEIGHT_FRACTION);
  return options.minHeight + range * t;
}
