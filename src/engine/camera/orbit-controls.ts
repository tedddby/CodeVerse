import { CameraControlsImpl } from "@react-three/drei";
import {
  Box3,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
} from "three";
import { MAX_POLAR, MIN_POLAR, clippingPlanes, distanceLimits, type FrameSphere } from "./poses";

/**
 * Orbit navigation via camera-controls (the library behind drei's
 * <CameraControls>): smooth damping, polar limits so the camera never goes
 * below the ground, dolly to cursor, right-drag ground panning, and distance
 * limits / clipping planes scaled to the world.
 */

export interface WorldInfo {
  frame: FrameSphere;
  size: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
}

/** Framing used before any repository is loaded (the empty grid). */
export const EMPTY_WORLD: WorldInfo = {
  frame: { center: [0, 0, 0], radius: 60 },
  size: 160,
  bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80, maxY: 0 },
};

export const CONTROL_ACTION = CameraControlsImpl.ACTION;

let installed = false;

/** camera-controls needs the three.js classes it uses injected once. */
function installCameraControls(): void {
  if (installed) return;
  CameraControlsImpl.install({
    THREE: {
      Box3,
      MathUtils: { clamp: MathUtils.clamp },
      Matrix4,
      Quaternion,
      Raycaster,
      Sphere,
      Spherical,
      Vector2,
      Vector3,
      Vector4,
    },
  });
  installed = true;
}

export function createOrbitControls(camera: Camera): CameraControlsImpl {
  installCameraControls();
  const controls = new CameraControlsImpl(camera as PerspectiveCamera);
  controls.smoothTime = 0.22;
  controls.draggingSmoothTime = 0.09;
  controls.dollyToCursor = true;
  controls.dollySpeed = 0.7;
  controls.truckSpeed = 1.6;
  controls.minPolarAngle = MIN_POLAR;
  controls.maxPolarAngle = MAX_POLAR;
  controls.mouseButtons.left = CONTROL_ACTION.ROTATE;
  controls.mouseButtons.middle = CONTROL_ACTION.DOLLY;
  // TRUCK pans across the ground plane (map-like); SCREEN_PAN would pan in screen space.
  controls.mouseButtons.right = CONTROL_ACTION.TRUCK;
  controls.mouseButtons.wheel = CONTROL_ACTION.DOLLY;
  controls.touches.one = CONTROL_ACTION.TOUCH_ROTATE;
  controls.touches.two = CONTROL_ACTION.TOUCH_DOLLY_TRUCK;
  controls.touches.three = CONTROL_ACTION.TOUCH_TRUCK;
  return controls;
}

/** Distance limits, target boundary and camera clipping planes for a world. */
export function applyWorldLimits(
  controls: CameraControlsImpl,
  camera: Camera,
  world: WorldInfo,
): void {
  const { size, bounds } = world;
  const limits = distanceLimits(size);
  controls.minDistance = limits.min;
  controls.maxDistance = limits.max;
  const margin = size * 0.35;
  controls.setBoundary(
    new Box3(
      new Vector3(bounds.minX - margin, 0, bounds.minZ - margin),
      new Vector3(bounds.maxX + margin, Math.max(bounds.maxY, 1) + margin, bounds.maxZ + margin),
    ),
  );
  if (camera instanceof PerspectiveCamera) {
    const planes = clippingPlanes(size);
    camera.near = planes.near;
    camera.far = planes.far;
    camera.updateProjectionMatrix();
  }
}
