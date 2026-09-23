import { createFileBlock, evaluateBlockFit, type BlockFit, type FileBlock } from "./file-block";
import { orderFilesForPacking, type IntraDirectoryAdjacency } from "./file-order";
import { clamp, compareStrings, insetRect, type Rect } from "./geometry";
import type { LayoutFileInput } from "./layout-input";
import type { LayoutDirectory, LayoutTree } from "./layout-tree";
import { buildingFootprint } from "./metrics";
import { squarify } from "./squarify";
import type { LayoutOptions } from "./types";

/**
 * The city planner: a hierarchical squarified treemap over the directory tree.
 *
 * Every district's content rectangle (its slab inset by its "ring", normally
 * half the district padding) is split by a squarified treemap into one slot per
 * child directory plus one slot for the directory's own file block. Each slot
 * is inset by the ring again, so sibling districts are separated by
 * `districtPadding` and a nested district sits `districtPadding` inside its
 * parent's edge.
 *
 * Pass-through directories (no files of their own and exactly one child, e.g.
 * Java's `src/main/java/com/acme`) use a thinner ring
 * (`PASS_THROUGH_RING_SCALE`), so package chains still read as terraces
 * without turning a single file into a sprawling ziggurat.
 *
 * Weights are areas: a file block asks for the tightest square that holds its
 * buildings (plus slack and omitted-file lots); a district asks for the sum of
 * its slots plus its ring. Every item also asks for enough area that a slot of
 * aspect ratio up to `ASPECT_TOLERANCE` still fits its widest building.
 * Because treemap slots can be more elongated than that and buildings are
 * discrete, a slot can still be too small for its buildings. The planner then
 * grows the slot of every overflowing block by its (slot-relative, linear)
 * overflow factor and re-runs the treemap. The treemap order of every item is
 * frozen after the first pass, so growing a slot resizes it in place instead
 * of reshuffling (and squeezing) its siblings; in practice this converges in
 * 2-12 passes, even for 25k files or thousands of single-file directories.
 * If a block still overflows after `MAX_PLAN_ITERATIONS`, its buildings are
 * scaled down at placement time — containment and non-overlap therefore hold
 * unconditionally.
 */

export interface BlockPlan {
  kind: "block";
  block: FileBlock;
  /** Iterative multiplier (>= 1) of the slot side, grown while the block overflows. */
  inflate: number;
  /** Slot area requested from the parent's treemap. */
  weight: number;
  /** Shortest slot side that can still hold the widest building. */
  minSide: number;
  /** Weight from the first pass; fixes the treemap order across passes. */
  orderWeight: number;
  /** Assigned block rectangle (slot minus margin). */
  rect: Rect;
  fit: BlockFit | null;
}

export interface DistrictPlan {
  kind: "district";
  directory: LayoutDirectory;
  parent: DistrictPlan | null;
  block: BlockPlan | null;
  children: DistrictPlan[];
  /** Block first, then child districts by path: canonical order for sums. */
  items: Array<BlockPlan | DistrictPlan>;
  /**
   * Width of the ground ring between the slab edge and the content, and of the
   * margin around each slot inside it.
   */
  ring: number;
  /** Side of the district slab when laid out as a square. */
  side: number;
  /** Slot area requested from the parent's treemap. */
  weight: number;
  /** Shortest slot side that can still hold the widest item inside. */
  minSide: number;
  /** Weight from the first pass; fixes the treemap order across passes. */
  orderWeight: number;
  /** Assigned district rectangle (slab). */
  rect: Rect;
}

export interface CityPlan {
  root: DistrictPlan;
  /** Districts in pre-order (parents before children). */
  districts: DistrictPlan[];
  blocks: BlockPlan[];
  /** Number of treemap passes that were run. */
  iterations: number;
  /** Whether every block fits without scaling. */
  converged: boolean;
}

export const MAX_PLAN_ITERATIONS = 24;

/** Ring width of pass-through districts, relative to the normal ring. */
export const PASS_THROUGH_RING_SCALE = 0.35;

/**
 * Aspect ratio up to which a treemap slot still satisfies an item's minimum
 * side: every item asks for at least `ASPECT_TOLERANCE * minSide²`. Without it,
 * small districts (where the fixed-width rings dominate) only fit in almost
 * perfectly square slots and the planner would oscillate.
 */
export const ASPECT_TOLERANCE = 1.3;

/** Extra ring so the content rectangle exceeds the children's total slot area. */
const RING_SLACK = 1.25;

/** Bounds on the per-pass growth of an overflowing block's slot side. */
const MIN_INFLATION_STEP = 1.02;
const MAX_INFLATION_STEP = 4;
/** Head-room added to each growth step so the next pass is unlikely to overflow again. */
const INFLATION_HEADROOM = 1.02;

const EMPTY_RECT: Rect = { x: 0, z: 0, width: 0, depth: 0 };

/** True for directories that only lead to a single sub-directory. */
export function isPassThroughDirectory(directory: LayoutDirectory): boolean {
  return (
    directory.files.length === 0 && directory.directOmitted === 0 && directory.children.length === 1
  );
}

export function createCityPlan(
  tree: LayoutTree,
  adjacency: IntraDirectoryAdjacency,
  options: LayoutOptions,
): CityPlan {
  const byDirectory = new Map<LayoutDirectory, DistrictPlan>();
  const districts: DistrictPlan[] = [];
  const blocks: BlockPlan[] = [];
  const sizeOf = (file: LayoutFileInput) => buildingFootprint(file, options);
  const half = options.districtPadding / 2;

  for (const directory of tree.preorder) {
    const district: DistrictPlan = {
      kind: "district",
      directory,
      parent: null,
      block: null,
      children: [],
      items: [],
      ring: isPassThroughDirectory(directory) ? half * PASS_THROUGH_RING_SCALE : half,
      side: 0,
      weight: 0,
      minSide: 0,
      orderWeight: 0,
      rect: EMPTY_RECT,
    };
    byDirectory.set(directory, district);
    districts.push(district);
  }

  for (const district of districts) {
    const directory = district.directory;
    // Children lists of the tree are content-bearing only, so every child has a plan.
    for (const childDirectory of directory.children) {
      const child = byDirectory.get(childDirectory);
      if (!child) continue;
      child.parent = district;
      district.children.push(child);
    }
    if (directory.files.length > 0 || directory.directOmitted > 0) {
      const ordered = orderFilesForPacking(directory.files, adjacency, sizeOf);
      const blockPlan: BlockPlan = {
        kind: "block",
        block: createFileBlock(directory.id, ordered, directory.directOmitted, options),
        inflate: 1,
        weight: 0,
        minSide: 0,
        orderWeight: 0,
        rect: EMPTY_RECT,
        fit: null,
      };
      district.block = blockPlan;
      blocks.push(blockPlan);
      district.items.push(blockPlan);
    }
    district.items.push(...district.children);
  }

  const root = byDirectory.get(tree.root);
  if (!root) throw new Error("Layout tree has no root district");
  return { root, districts, blocks, iterations: 0, converged: false };
}

/** Bottom-up slot areas: blocks from their packing, districts from their children. */
function computeWeights(plan: CityPlan): void {
  for (let index = plan.districts.length - 1; index >= 0; index -= 1) {
    const district = plan.districts[index];
    if (!district) continue;
    const ring = district.ring;
    let content = 0;
    let widest = 0;
    for (const item of district.items) {
      if (item.kind === "block") {
        const side = (Math.sqrt(item.block.baseArea) + 2 * ring) * item.inflate;
        item.minSide = (item.block.largestCell + 2 * ring) * item.inflate;
        item.weight = Math.max(side * side, ASPECT_TOLERANCE * item.minSide * item.minSide);
      }
      content += item.weight;
      if (item.minSide > widest) widest = item.minSide;
    }
    district.side = Math.max(Math.sqrt(content) + 2 * ring * RING_SLACK, widest + 2 * ring);
    const parentRing = district.parent?.ring ?? 0;
    const slot = district.side + 2 * parentRing;
    district.minSide = widest + 2 * ring + 2 * parentRing;
    district.weight = Math.max(slot * slot, ASPECT_TOLERANCE * district.minSide * district.minSide);
  }
}

function itemPath(item: BlockPlan | DistrictPlan): string {
  return item.kind === "block" ? "" : item.directory.path;
}

/**
 * Treemap order: heavier first (by first-pass weight, so growing an overflowing
 * slot resizes it in place instead of reshuffling its siblings); ties put the
 * file block first, then path order.
 */
function compareItems(a: BlockPlan | DistrictPlan, b: BlockPlan | DistrictPlan): number {
  if (a.orderWeight !== b.orderWeight) return b.orderWeight - a.orderWeight;
  if (a.kind !== b.kind) return a.kind === "block" ? -1 : 1;
  return compareStrings(itemPath(a), itemPath(b));
}

/** Top-down placement: the root is a square centred on the origin. */
function placeDistricts(plan: CityPlan): void {
  const rootSide = plan.root.side;
  plan.root.rect = { x: -rootSide / 2, z: -rootSide / 2, width: rootSide, depth: rootSide };
  for (const district of plan.districts) {
    const content = insetRect(district.rect, district.ring);
    const items = [...district.items].sort(compareItems);
    const slots = squarify(
      items.map((item) => item.weight),
      content,
    );
    items.forEach((item, index) => {
      item.rect = insetRect(slots[index] ?? EMPTY_RECT, district.ring);
    });
  }
}

/** Runs treemap passes until every block's buildings fit its slot (or the pass budget is spent). */
export function solveCityPlan(plan: CityPlan): CityPlan {
  let converged = false;
  let iterations = 0;
  while (iterations < MAX_PLAN_ITERATIONS) {
    iterations += 1;
    computeWeights(plan);
    if (iterations === 1) {
      for (const district of plan.districts) {
        for (const item of district.items) item.orderWeight = item.weight;
      }
    }
    placeDistricts(plan);
    converged = true;
    for (const district of plan.districts) {
      const blockPlan = district.block;
      if (!blockPlan) continue;
      const fit = evaluateBlockFit(blockPlan.block, blockPlan.rect, district.ring);
      blockPlan.fit = fit;
      if (fit.fits) continue;
      converged = false;
      const overflow = Number.isFinite(fit.overflow) ? fit.overflow : MAX_INFLATION_STEP;
      blockPlan.inflate *= clamp(
        overflow * INFLATION_HEADROOM,
        MIN_INFLATION_STEP,
        MAX_INFLATION_STEP,
      );
    }
    if (converged) break;
  }
  plan.iterations = iterations;
  plan.converged = converged;
  return plan;
}
