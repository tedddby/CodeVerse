import type { BuildingLayout } from "@/engine/layout/types";

/**
 * World intro: buildings rise from the ground in a wave spreading out from
 * the centre. Timing is precomputed per instance (a delay attribute) and
 * driven by a single shader uniform, so no per-instance CPU work per frame.
 */

/** Delay of the outermost building, seconds. */
export const INTRO_MAX_DELAY = 0.85;
/** Rise time of a single building, seconds. */
export const INTRO_RISE_DURATION = 0.6;
/** Total intro length; the uniform can stop updating afterwards. */
export const INTRO_TOTAL_DURATION = INTRO_MAX_DELAY + INTRO_RISE_DURATION;
/** Uniform value meaning "intro finished / skipped". */
export const INTRO_DONE = 1e6;

/**
 * Per-building start delays (seconds) for the given building indices, ordered
 * like `indices`. The centre rises first; delay grows with the square root of
 * the normalized distance so the wave front accelerates slightly outward.
 */
export function computeIntroDelays(
  buildings: readonly BuildingLayout[],
  indices: ArrayLike<number>,
  center: { x: number; z: number },
  maxDistance: number,
  maxDelay = INTRO_MAX_DELAY,
): Float32Array {
  const delays = new Float32Array(indices.length);
  const reach = maxDistance > 0 ? maxDistance : 1;
  for (let i = 0; i < indices.length; i += 1) {
    const building = buildings[indices[i] ?? -1];
    if (!building) continue;
    const distance = Math.hypot(building.x - center.x, building.z - center.z);
    delays[i] = maxDelay * Math.sqrt(Math.min(1, distance / reach));
  }
  return delays;
}

/** Eased rise factor (0 = flat, 1 = full height) at intro time `t` for a delay. Mirrors the shader. */
export function riseFactor(t: number, delay: number, duration = INTRO_RISE_DURATION): number {
  const progress = Math.min(1, Math.max(0, (t - delay) / duration));
  return 1 - Math.pow(1 - progress, 3);
}
