import type { BuildingLayout, WorldBounds } from "@/engine/layout/types";

/**
 * Spatial chunking of buildings. Large worlds are split into a grid of chunks,
 * each rendered as its own InstancedMesh with a tight bounding sphere, so
 * three.js frustum-culls whole chunks and raycasting skips chunks the pointer
 * ray cannot hit. Small worlds use a single chunk (one draw call).
 */

/** Worlds with more buildings than this are split into chunks. */
export const CHUNKING_THRESHOLD = 4_000;
/** Target number of buildings per chunk once chunking kicks in. */
export const TARGET_CHUNK_SIZE = 1_500;

export interface BuildingChunk {
  /** Stable key (grid cell), unique within one layout. */
  key: string;
  /** Indices into `layout.buildings`, ascending. */
  indices: Uint32Array;
  /** Bounding sphere of every building box in the chunk. */
  center: [number, number, number];
  radius: number;
}

export interface ChunkingOptions {
  threshold?: number;
  targetChunkSize?: number;
}

function boundingSphere(
  buildings: readonly BuildingLayout[],
  indices: Uint32Array,
): Pick<BuildingChunk, "center" | "radius"> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const i of indices) {
    const b = buildings[i];
    if (!b) continue;
    minX = Math.min(minX, b.x - b.width / 2);
    maxX = Math.max(maxX, b.x + b.width / 2);
    minZ = Math.min(minZ, b.z - b.depth / 2);
    maxZ = Math.max(maxZ, b.z + b.depth / 2);
    minY = Math.min(minY, b.baseY);
    maxY = Math.max(maxY, b.baseY + b.height);
  }
  if (!Number.isFinite(minX)) return { center: [0, 0, 0], radius: 0 };
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  // Exact enclosing radius over box corners (tighter than the AABB diagonal for skewed chunks).
  let radiusSq = 0;
  for (const i of indices) {
    const b = buildings[i];
    if (!b) continue;
    const dx = Math.max(
      Math.abs(b.x - b.width / 2 - center[0]),
      Math.abs(b.x + b.width / 2 - center[0]),
    );
    const dy = Math.max(Math.abs(b.baseY - center[1]), Math.abs(b.baseY + b.height - center[1]));
    const dz = Math.max(
      Math.abs(b.z - b.depth / 2 - center[2]),
      Math.abs(b.z + b.depth / 2 - center[2]),
    );
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  return { center, radius: Math.sqrt(radiusSq) };
}

/**
 * Partitions buildings into chunks. Every building index appears in exactly
 * one chunk; the result is deterministic for a given layout.
 */
export function partitionBuildings(
  buildings: readonly BuildingLayout[],
  bounds: WorldBounds,
  options: ChunkingOptions = {},
): BuildingChunk[] {
  const count = buildings.length;
  if (count === 0) return [];
  const threshold = options.threshold ?? CHUNKING_THRESHOLD;
  if (count <= threshold) {
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) indices[i] = i;
    return [{ key: "all", indices, ...boundingSphere(buildings, indices) }];
  }

  const target = Math.max(1, options.targetChunkSize ?? TARGET_CHUNK_SIZE);
  const cells = Math.max(2, Math.ceil(Math.sqrt(count / target)));
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1e-6, bounds.maxZ - bounds.minZ);
  const cellOf = (value: number, min: number, span: number) =>
    Math.min(cells - 1, Math.max(0, Math.floor(((value - min) / span) * cells)));

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < count; i += 1) {
    const b = buildings[i];
    if (!b) continue;
    const cell = cellOf(b.z, bounds.minZ, spanZ) * cells + cellOf(b.x, bounds.minX, spanX);
    const bucket = buckets.get(cell);
    if (bucket) bucket.push(i);
    else buckets.set(cell, [i]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cell, list]) => {
      const indices = Uint32Array.from(list);
      return { key: `cell-${cell}`, indices, ...boundingSphere(buildings, indices) };
    });
}
