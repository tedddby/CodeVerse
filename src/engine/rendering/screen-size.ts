import { PerspectiveCamera, Vector3, type Camera, type Object3D } from "three";

/**
 * Screen-constant sizing for in-world labels: world units covered by one
 * screen pixel at a point, and a helper scaling an object so one local unit
 * spans a given number of pixels there.
 *
 * Labels are billboards (parallel to the image plane), so their projected
 * size depends on the point's view depth (distance along the view axis), not
 * its straight-line distance: using the latter would draw labels near the
 * screen edges up to 1/cos(angle off-axis) too large.
 */

const forward = new Vector3();

export function worldUnitsPerPixel(
  camera: Camera,
  viewportHeight: number,
  x: number,
  y: number,
  z: number,
): number {
  camera.getWorldDirection(forward);
  const depth =
    (x - camera.position.x) * forward.x +
    (y - camera.position.y) * forward.y +
    (z - camera.position.z) * forward.z;
  const perspective = camera instanceof PerspectiveCamera;
  const near = perspective ? Math.max(1e-3, camera.near) : 1e-3;
  const fov = perspective ? camera.getEffectiveFOV() : 45;
  return (
    (2 * Math.tan((fov * Math.PI) / 360) * Math.max(depth, near)) / Math.max(1, viewportHeight)
  );
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
