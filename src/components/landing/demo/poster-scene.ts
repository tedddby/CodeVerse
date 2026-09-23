import { computeWorldLayout } from "@/engine/layout/compute-layout";
import type { WorldLayout } from "@/engine/layout/types";
import { RENDER_HEX } from "@/engine/rendering/palette";
import type { FileNode, RepositoryGraph } from "@/graph/model/types";
import { getLanguageColor } from "@/lib/languages/registry";
import { byDepth, desaturateHex, type IsoBox } from "../iso";

/**
 * Static projection of the real 3D world, used as the demo's poster: the image
 * shown before WebGL starts and whenever it is unavailable. It uses the
 * engine's own deterministic `computeWorldLayout`, so the poster and the live
 * world share exactly the same geometry and the cross-fade between them is
 * seamless. Colors follow the renderer's architecture mode.
 */

export interface PosterDistrict extends IsoBox {
  /** DirectoryNode id. */
  id: string;
  /** Nesting level (root = 0). */
  level: number;
  /** Directory name for top-level districts; undefined for the rest. */
  label?: string;
}

export interface PosterBuilding extends IsoBox {
  /** FileNode id. */
  id: string;
  color: string;
}

export interface PosterScene {
  /** Terraces, lower levels first, then far to near. */
  districts: PosterDistrict[];
  /** Buildings in painter's order: every building comes after all buildings it can hide. */
  buildings: PosterBuilding[];
}

/** Architecture-mode color of a file, mirroring the renderer's encoder. */
export function architectureColor(file: FileNode | undefined): string {
  if (!file) return RENDER_HEX.neutral;
  if (file.status === "binary") return RENDER_HEX.binary;
  const base = getLanguageColor(file.language);
  if (file.isGenerated || file.category === "vendor") return desaturateHex(base, 0.6);
  if (file.category === "test" || file.category === "docs" || file.category === "config") {
    return desaturateHex(base, 0.35);
  }
  return base;
}

const EPSILON = 1e-6;

function extent(box: IsoBox) {
  return {
    minX: box.x - box.width / 2,
    maxX: box.x + box.width / 2,
    minZ: box.z - box.depth / 2,
    maxZ: box.z + box.depth / 2,
  };
}

/**
 * True when `a` must be drawn before `b` because `b` is nearer to the viewer
 * (who looks from +X/+Z) and their projections can overlap.
 */
export function drawsBefore(a: IsoBox, b: IsoBox): boolean {
  const ea = extent(a);
  const eb = extent(b);
  const behindOnX = ea.maxX <= eb.minX + EPSILON;
  const behindOnZ = ea.maxZ <= eb.minZ + EPSILON;
  const overlapX = ea.minX < eb.maxX - EPSILON && eb.minX < ea.maxX - EPSILON;
  const overlapZ = ea.minZ < eb.maxZ - EPSILON && eb.minZ < ea.maxZ - EPSILON;
  return (behindOnX && (overlapZ || behindOnZ)) || (behindOnZ && overlapX);
}

/** Above this many boxes the O(n²) exact sort falls back to a center-depth sort. */
const EXACT_SORT_LIMIT = 1_500;

/**
 * Painter's order for non-overlapping footprints: a topological sort of the
 * `drawsBefore` relation, with center depth as the deterministic tie-breaker.
 */
export function paintersOrder<T extends IsoBox>(boxes: readonly T[]): T[] {
  const byCenter = [...boxes].sort(byDepth);
  if (byCenter.length > EXACT_SORT_LIMIT) return byCenter;
  const count = byCenter.length;
  const blockers = new Array<number>(count).fill(0);
  const successors: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      const a = byCenter[i];
      const b = byCenter[j];
      if (i === j || !a || !b || !drawsBefore(a, b)) continue;
      successors[i]?.push(j);
      blockers[j] = (blockers[j] ?? 0) + 1;
    }
  }
  const ordered: T[] = [];
  const done = new Array<boolean>(count).fill(false);
  // Repeatedly emit the nearest-to-the-back box with no pending blockers.
  for (let emitted = 0; emitted < count; emitted += 1) {
    let next = -1;
    for (let i = 0; i < count; i += 1) {
      if (!done[i] && blockers[i] === 0) {
        next = i;
        break;
      }
    }
    // A cycle cannot occur for disjoint footprints; fall back to depth order if it ever does.
    if (next === -1) next = done.findIndex((isDone) => !isDone);
    done[next] = true;
    const box = byCenter[next];
    if (box) ordered.push(box);
    for (const successor of successors[next] ?? [])
      blockers[successor] = (blockers[successor] ?? 0) - 1;
  }
  return ordered;
}

export function buildPosterScene(
  graph: RepositoryGraph,
  layout: WorldLayout = computeWorldLayout(graph),
): PosterScene {
  const directories = new Map(graph.directories.map((directory) => [directory.id, directory]));
  const files = new Map(graph.files.map((file) => [file.id, file]));

  const districts: PosterDistrict[] = layout.districts.map((district) => ({
    id: district.id,
    level: district.level,
    label: district.level === 1 ? directories.get(district.id)?.name : undefined,
    x: district.x,
    z: district.z,
    width: district.width,
    depth: district.depth,
    height: district.height,
    baseY: district.baseY,
  }));
  districts.sort((a, b) => a.level - b.level || byDepth(a, b));

  const buildings: PosterBuilding[] = layout.buildings.map((building) => ({
    id: building.id,
    color: architectureColor(files.get(building.id)),
    x: building.x,
    z: building.z,
    width: building.width,
    depth: building.depth,
    height: building.height,
    baseY: building.baseY,
  }));

  return { districts, buildings: paintersOrder(buildings) };
}
