/**
 * Minimal perspective-projection math for level-of-detail decisions. Kept free
 * of three.js so LOD policies are cheap to evaluate and trivial to unit-test.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const DEG2RAD = Math.PI / 180;

/** Screen pixels covered by one world unit at `distance` from a perspective camera. */
export function pixelsPerWorldUnit(
  distance: number,
  fovYDegrees: number,
  viewportHeightPx: number,
): number {
  const safeDistance = Math.max(1e-6, distance);
  const halfHeightWorld =
    Math.tan((Math.max(1, Math.min(179, fovYDegrees)) * DEG2RAD) / 2) * safeDistance;
  return viewportHeightPx / (2 * halfHeightWorld);
}

/** Approximate on-screen size in pixels of an object of `worldSize` at `distance`. */
export function projectedSizePx(
  worldSize: number,
  distance: number,
  fovYDegrees: number,
  viewportHeightPx: number,
): number {
  return Math.max(0, worldSize) * pixelsPerWorldUnit(distance, fovYDegrees, viewportHeightPx);
}

export function distance3(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
