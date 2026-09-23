import { roundCoordinate, type Rect } from "./geometry";
import type { LayoutFileInput } from "./layout-input";
import { buildingFootprint, buildingHeight } from "./metrics";
import { minimalSquareSide, shelfPack, shelfPackHeight } from "./shelf-pack";
import type { BuildingLayout, LayoutOptions } from "./types";

/**
 * A district's "file block": the rectangle holding the buildings of the files
 * that live directly in that directory (plus reserved ground for files the
 * analysis omitted). Each building occupies a square cell of side
 * `footprint + buildingGap`, so neighbouring buildings are always separated by
 * at least `buildingGap` and never touch the block edge.
 */
export interface FileBlock {
  directoryId: string;
  /** Files in packing order (see file-order.ts). */
  files: LayoutFileInput[];
  footprints: Float64Array;
  heights: Float64Array;
  /** Cell side per file: footprint + buildingGap. */
  cells: Float64Array;
  largestCell: number;
  /** Area the block asks the treemap for (before iterative inflation). */
  baseArea: number;
}

/**
 * Ground reserved per omitted file, as a fraction of a minimum-size cell.
 * Omitted files are not drawn, but their directory keeps a plausible footprint
 * so directory-first views still show the repository's real structure.
 */
export const OMITTED_LOT_DENSITY = 0.6;

/**
 * Extra area on top of the tightest square packing. Gives the treemap room for
 * slightly non-square slots without triggering a re-layout.
 */
const BLOCK_AREA_SLACK = 1.08;

export function createFileBlock(
  directoryId: string,
  orderedFiles: LayoutFileInput[],
  omittedCount: number,
  options: LayoutOptions,
): FileBlock {
  const count = orderedFiles.length;
  const footprints = new Float64Array(count);
  const heights = new Float64Array(count);
  const cells = new Float64Array(count);
  let largestCell = 0;
  for (let index = 0; index < count; index += 1) {
    const file = orderedFiles[index];
    if (!file) continue;
    const footprint = buildingFootprint(file, options);
    footprints[index] = footprint;
    heights[index] = buildingHeight(file, options);
    const cell = footprint + options.buildingGap;
    cells[index] = cell;
    if (cell > largestCell) largestCell = cell;
  }
  const packedSide = minimalSquareSide(cells);
  const lot = options.minFootprint + options.buildingGap;
  const omittedArea = Math.max(0, omittedCount) * lot * lot * OMITTED_LOT_DENSITY;
  const baseArea = Math.max(packedSide * packedSide * BLOCK_AREA_SLACK + omittedArea, lot * lot);
  return { directoryId, files: orderedFiles, footprints, heights, cells, largestCell, baseArea };
}

/** How the block's buildings fit into an assigned rectangle. */
export interface BlockFit {
  fits: boolean;
  /**
   * Linear overflow factor (>= 1): how much the block's slot (the block plus
   * its surrounding margin) must grow on each side for the packing to fit,
   * assuming the slot keeps its aspect ratio. 1 when it fits.
   */
  overflow: number;
  /** True when rows run along Z instead of X. */
  transposed: boolean;
  /** Row width to pack with (never narrower than the widest cell). */
  packWidth: number;
}

interface OrientationTrial {
  transposed: boolean;
  along: number;
  across: number;
  height: number;
}

function trial(
  block: FileBlock,
  along: number,
  across: number,
  transposed: boolean,
): OrientationTrial {
  return { transposed, along, across, height: shelfPackHeight(block.cells, along) };
}

function overflowOf(block: FileBlock, attempt: OrientationTrial, margin: number): number {
  if (!Number.isFinite(attempt.height)) {
    // A building is wider than the slot: grow until the widest cell fits.
    const available = attempt.along + 2 * margin;
    return available > 0 ? (block.largestCell + 2 * margin) / available : Number.POSITIVE_INFINITY;
  }
  const available = attempt.across + 2 * margin;
  return available > 0 ? (attempt.height + 2 * margin) / available : Number.POSITIVE_INFINITY;
}

/**
 * Packs the block into `rect`, trying rows along the longer side first and
 * falling back to the other orientation. Reports the overflow factor when
 * neither orientation fits. `margin` is the gap between the block and the
 * edge of its treemap slot, used to express the overflow relative to the slot.
 */
export function evaluateBlockFit(block: FileBlock, rect: Rect, margin = 0): BlockFit {
  if (block.files.length === 0) {
    return { fits: true, overflow: 1, transposed: false, packWidth: 0 };
  }
  const primary =
    rect.width >= rect.depth
      ? trial(block, rect.width, rect.depth, false)
      : trial(block, rect.depth, rect.width, true);
  const attempts: OrientationTrial[] = [primary];
  if (!(primary.height <= primary.across)) {
    attempts.push(
      primary.transposed
        ? trial(block, rect.width, rect.depth, false)
        : trial(block, rect.depth, rect.width, true),
    );
  }
  for (const attempt of attempts) {
    if (attempt.height <= attempt.across) {
      return { fits: true, overflow: 1, transposed: attempt.transposed, packWidth: attempt.along };
    }
  }
  let best = attempts[0] ?? primary;
  let bestOverflow = overflowOf(block, best, margin);
  for (const attempt of attempts) {
    const overflow = overflowOf(block, attempt, margin);
    if (overflow < bestOverflow) {
      best = attempt;
      bestOverflow = overflow;
    }
  }
  return {
    fits: false,
    overflow: Math.max(1, bestOverflow),
    transposed: best.transposed,
    // Used only if the planner gives up and scales this block down to fit.
    packWidth: Math.max(best.along, block.largestCell),
  };
}

/**
 * Packs the block's buildings into `rect` as described by `fit`.
 *
 * Rows and columns are spread over spare space (at most `1.5 * buildingGap`
 * extra per gap, so sparse districts do not scatter) and the result is centred.
 * If the packing does not fit (the planner exhausted its iterations), the whole
 * arrangement is scaled down uniformly, which preserves non-overlap and
 * containment at the cost of smaller buildings.
 */
export function placeBlockBuildings(
  block: FileBlock,
  rect: Rect,
  fit: BlockFit,
  baseY: number,
  options: LayoutOptions,
): BuildingLayout[] {
  if (block.files.length === 0) return [];
  const packing = shelfPack(block.cells, Math.max(fit.packWidth, block.largestCell));
  if (!packing) return [];
  const along = fit.transposed ? rect.depth : rect.width;
  const across = fit.transposed ? rect.width : rect.depth;
  const scale = Math.min(
    1,
    packing.width > 0 ? along / packing.width : 1,
    packing.height > 0 ? across / packing.height : 1,
  );
  const maxExtra = options.buildingGap * 1.5;
  const rowCount = packing.rowTop.length;

  const usedAcross = packing.height * scale;
  const rowExtra =
    scale < 1 ? 0 : Math.min(maxExtra, Math.max(0, across - usedAcross) / (rowCount + 1));
  const offsetAcross = (across - usedAcross - rowExtra * (rowCount - 1)) / 2;

  const rowOffsetAlong = new Float64Array(rowCount);
  const columnExtra = new Float64Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const columns = packing.rowColumnCount[row] ?? 1;
    const usedAlong = (packing.rowWidth[row] ?? 0) * scale;
    const extra =
      scale < 1 ? 0 : Math.min(maxExtra, Math.max(0, along - usedAlong) / (columns + 1));
    columnExtra[row] = extra;
    rowOffsetAlong[row] = (along - usedAlong - extra * (columns - 1)) / 2;
  }

  const buildings: BuildingLayout[] = [];
  for (let index = 0; index < block.files.length; index += 1) {
    const file = block.files[index];
    if (!file) continue;
    const row = packing.cellRow[index] ?? 0;
    const column = packing.cellColumn[index] ?? 0;
    const cell = (block.cells[index] ?? 0) * scale;
    const u =
      (rowOffsetAlong[row] ?? 0) +
      (packing.cellX[index] ?? 0) * scale +
      (columnExtra[row] ?? 0) * column +
      cell / 2;
    const v =
      offsetAcross +
      ((packing.rowTop[row] ?? 0) + (packing.cellY[index] ?? 0)) * scale +
      rowExtra * row +
      cell / 2;
    const footprint = (block.footprints[index] ?? 0) * scale;
    buildings.push({
      id: file.id,
      districtId: block.directoryId,
      x: roundCoordinate(rect.x + (fit.transposed ? v : u)),
      z: roundCoordinate(rect.z + (fit.transposed ? u : v)),
      width: roundCoordinate(footprint),
      depth: roundCoordinate(footprint),
      height: roundCoordinate(block.heights[index] ?? 0),
      baseY: roundCoordinate(baseY),
    });
  }
  return buildings;
}
