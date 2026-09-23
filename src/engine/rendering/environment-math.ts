/**
 * Pure helpers for the environment (fog, dust field, grid spacing), scaled to
 * the world so small and huge repositories get the same sense of depth.
 */

/** Exponential-squared fog density: ~7% at the near edge of an overview, ~30% at the far edge. */
export function fogDensity(worldSize: number): number {
  return 0.25 / Math.max(1, worldSize);
}

/** Small deterministic PRNG (mulberry32) so the dust field is identical on every load. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points on a wide shell, mostly above the horizon (visible when flying low). */
export function dustPositions(count: number, radius: number, seed = 7): Float32Array {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const azimuth = random() * Math.PI * 2;
    // Elevation from slightly below the horizon up to ~70°.
    const elevation = -0.05 + random() * 1.25;
    const r = radius * (0.75 + random() * 0.5);
    positions[i * 3] = Math.cos(elevation) * Math.cos(azimuth) * r;
    positions[i * 3 + 1] = Math.sin(elevation) * r;
    positions[i * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * r;
  }
  return positions;
}

/** Rounds up to a "nice" 1 / 2 / 5 × 10^k step. */
export function niceStep(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * base;
}
