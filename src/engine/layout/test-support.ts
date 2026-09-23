/**
 * Test-only helpers for the layout engine: seeded graph shuffling and a
 * checker that collects every violated layout invariant as readable strings
 * (so a failing test prints exactly what went wrong).
 *
 * Not imported by production code.
 */
import { mulberry32 } from "@/fixtures/fixture-builder";
import type { RepositoryGraph } from "@/graph/model/types";
import type { BuildingLayout, DistrictLayout, LayoutOptions, WorldLayout } from "./types";

/** Tolerance for rounded (1/1000 unit) output coordinates. */
export const COORDINATE_TOLERANCE = 2e-3;

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const a = items[index];
    const b = items[other];
    if (a === undefined || b === undefined) continue;
    items[index] = b;
    items[other] = a;
  }
  return items;
}

/** Deep copy of `graph` with every array relevant to layout shuffled deterministically. */
export function shuffleGraph(graph: RepositoryGraph, seed: number): RepositoryGraph {
  const random = mulberry32(seed);
  const copy = structuredClone(graph);
  shuffleInPlace(copy.directories, random);
  shuffleInPlace(copy.files, random);
  shuffleInPlace(copy.dependencies, random);
  shuffleInPlace(copy.symbols, random);
  for (const directory of copy.directories) {
    shuffleInPlace(directory.childDirectoryIds, random);
    shuffleInPlace(directory.fileIds, random);
  }
  return copy;
}

/** Layout without the timing field, for determinism comparisons. */
export function withoutDuration(layout: WorldLayout): Omit<WorldLayout, "durationMs"> {
  const { durationMs: _durationMs, ...rest } = layout;
  return rest;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function boxOf(item: { x: number; z: number; width: number; depth: number }): Box {
  return {
    minX: item.x - item.width / 2,
    maxX: item.x + item.width / 2,
    minZ: item.z - item.depth / 2,
    maxZ: item.z + item.depth / 2,
  };
}

/** True when `inner` lies inside `outer` shrunk by `margin` (tolerance included). */
export function contains(outer: Box, inner: Box, margin = 0): boolean {
  const t = COORDINATE_TOLERANCE;
  return (
    inner.minX >= outer.minX + margin - t &&
    inner.maxX <= outer.maxX - margin + t &&
    inner.minZ >= outer.minZ + margin - t &&
    inner.maxZ <= outer.maxZ - margin + t
  );
}

/** True when the interiors of `a` and `b` (each grown by `grow`) intersect. */
export function overlaps(a: Box, b: Box, grow = 0): boolean {
  const t = COORDINATE_TOLERANCE;
  return (
    a.minX - grow < b.maxX + grow - t &&
    b.minX - grow < a.maxX + grow - t &&
    a.minZ - grow < b.maxZ + grow - t &&
    b.minZ - grow < a.maxZ + grow - t
  );
}

/** Pairs of overlapping boxes, found with a sweep over X (O(n log n + k)). */
export function findOverlaps<
  T extends { id: string; x: number; z: number; width: number; depth: number },
>(items: readonly T[], grow = 0): Array<[string, string]> {
  const boxes = items
    .map((item) => ({ id: item.id, box: boxOf(item) }))
    .sort((a, b) => a.box.minX - b.box.minX);
  const result: Array<[string, string]> = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    if (!a) continue;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      if (!b) continue;
      if (b.box.minX - grow >= a.box.maxX + grow - COORDINATE_TOLERANCE) break;
      if (overlaps(a.box, b.box, grow)) result.push([a.id, b.id]);
    }
  }
  return result;
}

/** Directory ids that must have a district: the root and every directory containing files. */
export function expectedDistrictIds(graph: RepositoryGraph): Set<string> {
  const byId = new Map(graph.directories.map((directory) => [directory.id, directory] as const));
  const expected = new Set<string>([graph.rootDirectoryId]);
  const hasContent = (id: string): boolean => {
    const directory = byId.get(id);
    if (!directory) return false;
    if (directory.fileIds.length > 0 || directory.stats.omittedFileCount > 0) return true;
    return directory.childDirectoryIds.some(hasContent);
  };
  for (const directory of graph.directories)
    if (hasContent(directory.id)) expected.add(directory.id);
  return expected;
}

/**
 * Checks every structural invariant of `layout` against `graph`.
 * `streetMargin` additionally requires buildings to keep at least
 * `buildingGap` between each other (true unless a block had to be scaled).
 */
export function collectLayoutViolations(
  graph: RepositoryGraph,
  layout: WorldLayout,
  options: LayoutOptions,
  { streetMargin = true }: { streetMargin?: boolean } = {},
): string[] {
  const violations: string[] = [];
  const directories = new Map(
    graph.directories.map((directory) => [directory.id, directory] as const),
  );
  const districts = new Map<string, DistrictLayout>();
  for (const district of layout.districts) {
    if (districts.has(district.id)) violations.push(`duplicate district ${district.id}`);
    districts.set(district.id, district);
  }

  // Districts: exactly the expected set, correct level/terrace, nested in parents.
  const expected = expectedDistrictIds(graph);
  for (const id of expected) if (!districts.has(id)) violations.push(`missing district ${id}`);
  for (const district of layout.districts) {
    if (!expected.has(district.id)) violations.push(`unexpected district ${district.id}`);
    const directory = directories.get(district.id);
    if (directory && district.level !== directory.depth) {
      violations.push(
        `district ${district.id} level ${district.level} != depth ${directory.depth}`,
      );
    }
    if (Math.abs(district.baseY - district.level * options.slabHeight) > COORDINATE_TOLERANCE) {
      violations.push(`district ${district.id} baseY ${district.baseY} not terraced`);
    }
    if (!(district.width > 0 && district.depth > 0)) {
      violations.push(`district ${district.id} has empty extent`);
    }
    if (!(district.labelSize > 0)) violations.push(`district ${district.id} has no label size`);
    const parentId = directory?.parentId;
    const parent = parentId ? districts.get(parentId) : undefined;
    if (parentId && !parent) violations.push(`district ${district.id} parent has no district`);
    if (parent) {
      if (!contains(boxOf(parent), boxOf(district))) {
        violations.push(`district ${district.id} escapes parent ${parent.id}`);
      }
      if (Math.abs(district.baseY - (parent.baseY + parent.height)) > COORDINATE_TOLERANCE) {
        violations.push(`district ${district.id} does not sit on its parent's slab`);
      }
    }
  }

  // Sibling districts never overlap.
  const childrenOf = new Map<string, DistrictLayout[]>();
  for (const district of layout.districts) {
    const parentId = directories.get(district.id)?.parentId;
    if (!parentId) continue;
    const list = childrenOf.get(parentId) ?? [];
    list.push(district);
    childrenOf.set(parentId, list);
  }
  for (const [parentId, siblings] of childrenOf) {
    for (const [a, b] of findOverlaps(siblings)) {
      violations.push(`sibling districts ${a} and ${b} overlap (parent ${parentId})`);
    }
  }

  // Buildings: one per file, inside their district, not overlapping anything.
  const buildings = new Map<string, BuildingLayout>();
  for (const building of layout.buildings) {
    if (buildings.has(building.id)) violations.push(`duplicate building ${building.id}`);
    buildings.set(building.id, building);
  }
  const buildingsByDistrict = new Map<string, BuildingLayout[]>();
  for (const file of graph.files) {
    const building = buildings.get(file.id);
    if (!building) {
      violations.push(`missing building ${file.id}`);
      continue;
    }
    if (building.districtId !== file.directoryId) {
      violations.push(
        `building ${file.id} in ${building.districtId}, expected ${file.directoryId}`,
      );
    }
    const list = buildingsByDistrict.get(building.districtId) ?? [];
    list.push(building);
    buildingsByDistrict.set(building.districtId, list);
  }
  if (layout.buildings.length !== graph.files.length) {
    violations.push(`${layout.buildings.length} buildings for ${graph.files.length} files`);
  }
  for (const building of layout.buildings) {
    const district = districts.get(building.districtId);
    if (!district) {
      violations.push(`building ${building.id} has no district`);
      continue;
    }
    if (!contains(boxOf(district), boxOf(building))) {
      violations.push(`building ${building.id} escapes district ${district.id}`);
    }
    if (Math.abs(building.baseY - (district.baseY + district.height)) > COORDINATE_TOLERANCE) {
      violations.push(`building ${building.id} does not stand on its district slab`);
    }
    if (!(building.width > 0 && building.height > 0)) {
      violations.push(`building ${building.id} is degenerate`);
    }
  }
  const grow = streetMargin ? options.buildingGap / 2 - COORDINATE_TOLERANCE : 0;
  for (const [districtId, list] of buildingsByDistrict) {
    for (const [a, b] of findOverlaps(list, grow)) {
      violations.push(`buildings ${a} and ${b} overlap in ${districtId}`);
    }
    for (const child of childrenOf.get(districtId) ?? []) {
      for (const building of list) {
        if (overlaps(boxOf(building), boxOf(child))) {
          violations.push(`building ${building.id} overlaps nested district ${child.id}`);
        }
      }
    }
  }

  // Bounds match the geometry and the world is centred on the origin.
  const all = [...layout.districts, ...layout.buildings];
  const minX = Math.min(...all.map((item) => item.x - item.width / 2));
  const maxX = Math.max(...all.map((item) => item.x + item.width / 2));
  const minZ = Math.min(...all.map((item) => item.z - item.depth / 2));
  const maxZ = Math.max(...all.map((item) => item.z + item.depth / 2));
  const maxY = Math.max(...all.map((item) => item.baseY + item.height));
  const b = layout.bounds;
  const near = (x: number, y: number) => Math.abs(x - y) <= COORDINATE_TOLERANCE * 2;
  if (!near(b.minX, minX) || !near(b.maxX, maxX) || !near(b.minZ, minZ) || !near(b.maxZ, maxZ)) {
    violations.push(`bounds ${JSON.stringify(b)} do not match geometry`);
  }
  if (!near(b.maxY, maxY)) violations.push(`bounds.maxY ${b.maxY} != ${maxY}`);
  if (!near(b.size, Math.max(maxX - minX, maxZ - minZ))) violations.push(`bounds.size is wrong`);
  if (!near(b.minX + b.maxX, 0) || !near(b.minZ + b.maxZ, 0)) {
    violations.push(`world is not centred on the origin`);
  }
  return violations;
}
