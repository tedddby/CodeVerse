import { createCityPlan, solveCityPlan, type CityPlan, type DistrictPlan } from "./city-plan";
import { placeBlockBuildings } from "./file-block";
import { buildIntraDirectoryAdjacency } from "./file-order";
import { clamp, nowMs, roundCoordinate } from "./geometry";
import { layoutKey, type LayoutGraphInput } from "./layout-input";
import { buildLayoutTree } from "./layout-tree";
import { resolveLayoutOptions } from "./options";
import {
  LAYOUT_VERSION,
  type BuildingLayout,
  type DistrictLayout,
  type LayoutOptions,
  type WorldBounds,
  type WorldLayout,
} from "./types";

export { DEFAULT_LAYOUT_OPTIONS } from "./options";

/**
 * Deterministic city layout of a repository.
 *
 * Pipeline: normalize the directory tree (layout-tree.ts) -> order each
 * district's files so dependency-related files are adjacent (file-order.ts) ->
 * size and place districts with a hierarchical squarified treemap, iterating
 * until every file block fits (city-plan.ts) -> shelf-pack buildings inside
 * their blocks (file-block.ts, shelf-pack.ts) -> emit `WorldLayout`.
 *
 * Invariants (covered by tests):
 * - the same input yields the same output, whatever the order of its arrays
 *   (only `durationMs` differs);
 * - every file node has exactly one building; the root and every directory
 *   that contains files (directly or below, including omitted files) has
 *   exactly one district; directories without any files have none;
 * - buildings lie inside their district's slab and never overlap each other or
 *   any nested district; sibling districts never overlap; child districts lie
 *   inside their parent;
 * - districts are terraced: level L sits at y = L * slabHeight;
 * - the world is centred on the origin.
 *
 * Complexity: O(n log n) in files + directories + dependencies per treemap
 * pass, with a small bounded number of passes.
 */
export function computeWorldLayout(
  graph: LayoutGraphInput,
  options?: Partial<LayoutOptions>,
): WorldLayout {
  const startedAt = nowMs();
  const resolved = resolveLayoutOptions(options);
  const tree = buildLayoutTree(graph);
  const adjacency = buildIntraDirectoryAdjacency(graph.dependencies, tree.directoryOfFile);
  const plan = solveCityPlan(createCityPlan(tree, adjacency, resolved));
  const { districts, buildings } = emitLayout(plan, resolved);
  return {
    version: LAYOUT_VERSION,
    key: layoutKey(graph),
    bounds: computeBounds(districts, buildings),
    districts,
    buildings,
    durationMs: Math.round((nowMs() - startedAt) * 10) / 10,
  };
}

/** Label size bounds in world units. */
export const MIN_LABEL_SIZE = 0.5;
export const MAX_LABEL_SIZE = 16;
/** Label size relative to sqrt(district area). */
const LABEL_SIZE_RATIO = 0.08;
/** Approximate glyph advance of the label font, relative to the font size. */
const LABEL_GLYPH_ADVANCE = 0.6;
/** Share of the district width a label may span. */
const LABEL_WIDTH_SHARE = 0.9;

/**
 * Label font size proportional to the district size, reduced when the name
 * would not fit along the district's X extent, clamped to readable bounds.
 */
export function districtLabelSize(width: number, depth: number, name: string): number {
  const bySize = LABEL_SIZE_RATIO * Math.sqrt(Math.max(0, width * depth));
  const glyphs = Math.max(4, name.length);
  const byWidth = (Math.max(0, width) * LABEL_WIDTH_SHARE) / (glyphs * LABEL_GLYPH_ADVANCE);
  return clamp(Math.min(bySize, byWidth), MIN_LABEL_SIZE, MAX_LABEL_SIZE);
}

function toDistrictLayout(district: DistrictPlan, options: LayoutOptions): DistrictLayout {
  const { rect, directory } = district;
  return {
    id: directory.id,
    x: roundCoordinate(rect.x + rect.width / 2),
    z: roundCoordinate(rect.z + rect.depth / 2),
    width: roundCoordinate(rect.width),
    depth: roundCoordinate(rect.depth),
    baseY: roundCoordinate(directory.level * options.slabHeight),
    height: roundCoordinate(options.slabHeight),
    level: directory.level,
    labelSize: roundCoordinate(districtLabelSize(rect.width, rect.depth, directory.name)),
  };
}

function emitLayout(
  plan: CityPlan,
  options: LayoutOptions,
): { districts: DistrictLayout[]; buildings: BuildingLayout[] } {
  const districts: DistrictLayout[] = [];
  const buildings: BuildingLayout[] = [];
  for (const district of plan.districts) {
    districts.push(toDistrictLayout(district, options));
    const blockPlan = district.block;
    if (!blockPlan?.fit) continue;
    const baseY = (district.directory.level + 1) * options.slabHeight;
    const placed = placeBlockBuildings(
      blockPlan.block,
      blockPlan.rect,
      blockPlan.fit,
      baseY,
      options,
    );
    // Emit buildings of a district in path order: stable and easy to diff.
    placed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const building of placed) buildings.push(building);
  }
  return { districts, buildings };
}

function computeBounds(districts: DistrictLayout[], buildings: BuildingLayout[]): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let maxY = 0;
  const include = (x: number, z: number, width: number, depth: number, top: number) => {
    if (x - width / 2 < minX) minX = x - width / 2;
    if (x + width / 2 > maxX) maxX = x + width / 2;
    if (z - depth / 2 < minZ) minZ = z - depth / 2;
    if (z + depth / 2 > maxZ) maxZ = z + depth / 2;
    if (top > maxY) maxY = top;
  };
  for (const d of districts) include(d.x, d.z, d.width, d.depth, d.baseY + d.height);
  for (const b of buildings) include(b.x, b.z, b.width, b.depth, b.baseY + b.height);
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0, size: 0 };
  }
  return {
    minX: roundCoordinate(minX),
    maxX: roundCoordinate(maxX),
    minZ: roundCoordinate(minZ),
    maxZ: roundCoordinate(maxZ),
    maxY: roundCoordinate(maxY),
    size: roundCoordinate(Math.max(maxX - minX, maxZ - minZ)),
  };
}
