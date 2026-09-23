import { PerspectiveCamera, type Camera, type Object3D } from "three";

/**
 * Screen-constant sizing for in-world labels: world units covered by one
 * screen pixel at a point, and a helper scaling an object so one local unit
 * spans a given number of pixels there.
 */

export function worldUnitsPerPixel(
  camera: Camera,
  viewportHeight: number,
  x: number,
  y: number,
  z: number,
): number {
  const distance = Math.max(
    1e-3,
    Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z),
  );
  const fov = camera instanceof PerspectiveCamera ? camera.getEffectiveFOV() : 45;
  return (2 * Math.tan((fov * Math.PI) / 360) * distance) / Math.max(1, viewportHeight);
}

/** Scales `object` so one local unit spans `pixels` screen pixels at the given world point. */
export function applyScreenScale(
  object: Object3D,
  camera: Camera,
  viewportHeight: number,
  anchor: { x: number; y: number; z: number },
  pixels: number,
): number {
  const perPixel = worldUnitsPerPixel(camera, viewportHeight, anchor.x, anchor.y, anchor.z);
  object.scale.setScalar(pixels * perPixel);
  return perPixel;
}
