import { create } from "zustand";

/**
 * Renderer statistics for the performance overlay. Written ~2x/second by the
 * scene's stats probe (fps, draw calls, triangles) and whenever a layer's
 * content changes (instances, labels, edges) — never per frame.
 */
export interface RenderStatsValues {
  fps: number;
  drawCalls: number;
  triangles: number;
  /** Instanced objects submitted (buildings + district slabs + symbol bands). */
  instances: number;
  /** Text labels currently mounted. */
  labels: number;
  /** Dependency arcs currently drawn. */
  edges: number;
}

export interface RenderStats extends RenderStatsValues {
  set: (patch: Partial<RenderStatsValues>) => void;
}

export const INITIAL_RENDER_STATS: RenderStatsValues = {
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  instances: 0,
  labels: 0,
  edges: 0,
};

export const useRenderStats = create<RenderStats>()((set, get) => ({
  ...INITIAL_RENDER_STATS,
  set: (patch) => {
    const current = get();
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof RenderStatsValues>) {
      if (patch[key] !== undefined && patch[key] !== current[key]) {
        changed = true;
        break;
      }
    }
    if (changed) set(patch);
  },
}));

/**
 * Per-layer counters aggregated into `instances`, `labels` and `edges`. Layers
 * report their own contribution under a stable key so mounting/unmounting a
 * layer never leaves stale totals behind.
 */
const layerCounters = {
  instances: new Map<string, number>(),
  labels: new Map<string, number>(),
  edges: new Map<string, number>(),
};

export type CounterKind = keyof typeof layerCounters;

function total(map: Map<string, number>): number {
  let sum = 0;
  for (const value of map.values()) sum += value;
  return sum;
}

/** Reports (or with `count = 0`, clears) a layer's contribution to a counter. */
export function reportLayerCount(kind: CounterKind, layer: string, count: number): void {
  const map = layerCounters[kind];
  if (count <= 0) map.delete(layer);
  else map.set(layer, count);
  useRenderStats.getState().set({ [kind]: total(map) });
}
