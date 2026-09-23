import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  type ShaderMaterial,
} from "three";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { ExplorerState } from "@/state/explorer-store";
import { partitionBuildings } from "./chunking";
import { buildingFlags, refFileId, type BuildingVisuals } from "./encodings";
import { computeIntroDelays } from "./intro";
import { createInstancedBoxes, writeBoxMatrix } from "./instanced-boxes";
import { BUILDING_STATE } from "./materials/building-material";
import type { WorldContextValue } from "./world-context";

/**
 * Imperative GPU-side state of the buildings layer, kept outside React:
 * one InstancedMesh per spatial chunk with per-instance attributes
 * (color; emphasis/glow/state/flags; intro delay), plus the writes that keep
 * them in sync with the visual encoding, hover and selection.
 */

export interface ChunkRuntime {
  key: string;
  /** Indices into `layout.buildings`. */
  indices: Uint32Array;
  mesh: InstancedMesh;
  colors: InstancedBufferAttribute;
  /** emphasis, glow, state bits, honesty flags */
  params: InstancedBufferAttribute;
}

export interface BuildingRuntime {
  chunks: ChunkRuntime[];
  /** Global building index -> chunk index / local instance index. */
  chunkOf: Int32Array;
  localOf: Int32Array;
}

export interface StateIndices {
  hovered: number;
  selected: number;
}

export function createBuildingRuntime(
  layout: WorldLayout,
  material: ShaderMaterial,
): BuildingRuntime {
  const { buildings, bounds } = layout;
  const chunkOf = new Int32Array(buildings.length).fill(-1);
  const localOf = new Int32Array(buildings.length).fill(-1);
  const center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;

  const chunks = partitionBuildings(buildings, bounds).map((chunk, chunkIndex): ChunkRuntime => {
    const count = chunk.indices.length;
    const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(
      DynamicDrawUsage,
    );
    const params = new InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(
      DynamicDrawUsage,
    );
    const delays = new InstancedBufferAttribute(
      computeIntroDelays(buildings, chunk.indices, center, reach),
      1,
    );
    const mesh = createInstancedBoxes(
      count,
      material,
      { aColor: colors, aParams: params, aDelay: delays },
      chunk,
    );
    mesh.name = `buildings:${chunk.key}`;
    const matrices = mesh.instanceMatrix.array as Float32Array;
    for (let local = 0; local < count; local += 1) {
      const global = chunk.indices[local] ?? 0;
      const b = buildings[global];
      if (!b) continue;
      writeBoxMatrix(matrices, local, b.x, b.baseY, b.z, b.width, b.height, b.depth);
      params.array[local * 4] = 1;
      chunkOf[global] = chunkIndex;
      localOf[global] = local;
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { key: chunk.key, indices: chunk.indices, mesh, colors, params };
  });
  return { chunks, chunkOf, localOf };
}

export function disposeBuildingRuntime(runtime: BuildingRuntime): void {
  for (const chunk of runtime.chunks) {
    chunk.mesh.geometry.dispose();
    chunk.mesh.dispose();
  }
}

export function stateIndices(state: ExplorerState, world: WorldContextValue): StateIndices {
  const hoveredId = state.hovered?.kind === "file" ? state.hovered.id : null;
  const selectedId = refFileId(state.selection, world.index);
  return {
    hovered: hoveredId ? (world.lookup.buildingIndexById.get(hoveredId) ?? -1) : -1,
    selected: selectedId ? (world.lookup.buildingIndexById.get(selectedId) ?? -1) : -1,
  };
}

function stateBits(global: number, states: StateIndices): number {
  return (
    (global === states.hovered ? BUILDING_STATE.hovered : 0) |
    (global === states.selected ? BUILDING_STATE.selected : 0)
  );
}

export function writeVisuals(
  runtime: BuildingRuntime,
  visuals: BuildingVisuals,
  states: StateIndices,
  flagsOf: (global: number) => number,
): void {
  for (const chunk of runtime.chunks) {
    const colors = chunk.colors.array;
    const params = chunk.params.array;
    for (let local = 0; local < chunk.indices.length; local += 1) {
      const global = chunk.indices[local] ?? 0;
      colors[local * 3] = visuals.colors[global * 3] ?? 0;
      colors[local * 3 + 1] = visuals.colors[global * 3 + 1] ?? 0;
      colors[local * 3 + 2] = visuals.colors[global * 3 + 2] ?? 0;
      params[local * 4] = visuals.emphasis[global] ?? 1;
      params[local * 4 + 1] = visuals.glow[global] ?? 0;
      params[local * 4 + 2] = stateBits(global, states);
      params[local * 4 + 3] = flagsOf(global);
    }
    chunk.colors.needsUpdate = true;
    chunk.params.needsUpdate = true;
  }
}

/** Rewrites the state bits of instances whose hover/selection status changed. */
export function writeStateChange(
  runtime: BuildingRuntime,
  previous: StateIndices,
  next: StateIndices,
): void {
  for (const global of new Set([
    previous.hovered,
    previous.selected,
    next.hovered,
    next.selected,
  ])) {
    if (global < 0) continue;
    const chunk = runtime.chunks[runtime.chunkOf[global] ?? -1];
    const local = runtime.localOf[global] ?? -1;
    if (!chunk || local < 0) continue;
    chunk.params.array[local * 4 + 2] = stateBits(global, next);
    chunk.params.needsUpdate = true;
  }
}

export function flagsLookup(layout: WorldLayout, index: GraphIndex): (global: number) => number {
  return (global) => buildingFlags(index.filesById.get(layout.buildings[global]?.id ?? ""));
}
