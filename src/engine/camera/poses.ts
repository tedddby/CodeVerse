import type { CameraPose } from "@/state/explorer-store";

/**
 * Camera pose math. Pure functions over plain tuples (no three.js objects) so
 * framing rules are unit-testable and shareable with the share-link codec.
 *
 * Spherical convention matches three.js `Spherical`: `polar` is measured from
 * +Y (0 = straight down onto the target), `azimuth` around +Y from +Z.
 */

export type Vec3 = [number, number, number];

export interface FrameSphere {
  center: Vec3;
  radius: number;
}

export interface ViewSpec {
  /** Vertical field of view in degrees. */
  fovY: number;
  /** Viewport width / height. */
  aspect: number;
}

export interface SphericalOffset {
  distance: number;
  polar: number;
  azimuth: number;
}

const DEG2RAD = Math.PI / 180;

/** Canonical 3/4 overview: 45° around, ~36° above the horizon. */
export const OVERVIEW_AZIMUTH = Math.PI / 4;
export const OVERVIEW_POLAR = 54 * DEG2RAD;
/** Fit padding of the overview (below 1: the flat city fits well inside its sphere). */
export const OVERVIEW_PADDING = 0.82;
/** Orbit limits: never exactly top-down (gimbal) and never below the ground. */
export const MIN_POLAR = 0.02;
export const MAX_POLAR = Math.PI / 2 - 0.06;
/** Comfortable polar range when framing a node (keeps buildings readable). */
export const FRAME_MIN_POLAR = 28 * DEG2RAD;
export const FRAME_MAX_POLAR = 64 * DEG2RAD;
/** Fit padding when flying to a node: leaves some neighbourhood in view. */
export const FRAME_PADDING = 1.5;
/** Lowest camera altitude in any mode (world units). */
export const MIN_CAMERA_Y = 0.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Distance at which a sphere of `radius` fits the view (limiting fov), scaled by `padding`. */
export function fitDistance(radius: number, view: ViewSpec, padding = 1.1): number {
  const fovY = clamp(view.fovY, 1, 179) * DEG2RAD;
  const aspect = view.aspect > 0 && Number.isFinite(view.aspect) ? view.aspect : 1;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const limiting = Math.min(fovY, fovX);
  return (Math.max(radius, 1e-3) * padding) / Math.sin(limiting / 2);
}

export function poseFromSpherical(target: Vec3, offset: SphericalOffset): CameraPose {
  const sinPolar = Math.sin(offset.polar);
  return {
    position: [
      target[0] + offset.distance * sinPolar * Math.sin(offset.azimuth),
      target[1] + offset.distance * Math.cos(offset.polar),
      target[2] + offset.distance * sinPolar * Math.cos(offset.azimuth),
    ],
    target: [target[0], target[1], target[2]],
  };
}

export function sphericalOf(pose: CameraPose): SphericalOffset {
  const dx = pose.position[0] - pose.target[0];
  const dy = pose.position[1] - pose.target[1];
  const dz = pose.position[2] - pose.target[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-9) return { distance: 0, polar: 0, azimuth: 0 };
  return {
    distance,
    polar: Math.acos(clamp(dy / distance, -1, 1)),
    azimuth: Math.atan2(dx, dz),
  };
}

/** The canonical overview of a whole world frame. */
export function overviewPose(frame: FrameSphere, view: ViewSpec): CameraPose {
  // A city is flat: at a 3/4 angle its projection is well inside the bounding
  // sphere's, so a tighter fit reads better than the strict one. Aiming low
  // (near the ground centre) keeps the city visually centred on screen.
  const distance = fitDistance(frame.radius, view, OVERVIEW_PADDING);
  return poseFromSpherical(overviewTarget(frame), {
    distance,
    polar: OVERVIEW_POLAR,
    azimuth: OVERVIEW_AZIMUTH,
  });
}

/** Overview aim point: the frame centre lowered toward the ground. */
export function overviewTarget(frame: FrameSphere): Vec3 {
  return [frame.center[0], frame.center[1] * 0.3, frame.center[2]];
}

/** Where the cinematic establishing shot starts: high above, far out, rotated. */
export function establishingPose(frame: FrameSphere, view: ViewSpec): CameraPose {
  const distance = fitDistance(frame.radius, view, OVERVIEW_PADDING) * 2.4;
  return poseFromSpherical(overviewTarget(frame), {
    distance,
    polar: 0.22,
    azimuth: OVERVIEW_AZIMUTH - 0.7,
  });
}

/**
 * Frames a sphere while keeping the current heading (azimuth); the elevation is
 * clamped into a comfortable range so the target is seen at a readable angle.
 */
export function framePose(
  frame: FrameSphere,
  current: CameraPose | null,
  view: ViewSpec,
  minDistance = 0,
): CameraPose {
  const spherical = current ? sphericalOf(current) : null;
  const azimuth = spherical && spherical.distance > 0 ? spherical.azimuth : OVERVIEW_AZIMUTH;
  const polar =
    spherical && spherical.distance > 0
      ? clamp(spherical.polar, FRAME_MIN_POLAR, FRAME_MAX_POLAR)
      : OVERVIEW_POLAR;
  const distance = Math.max(minDistance, fitDistance(frame.radius, view, FRAME_PADDING));
  return poseFromSpherical(frame.center, { distance, polar, azimuth });
}

/** Moves the target to a ground point while keeping the viewing angle and distance. */
export function focusPointPose(current: CameraPose, x: number, z: number): CameraPose {
  const offset: Vec3 = [
    current.position[0] - current.target[0],
    current.position[1] - current.target[1],
    current.position[2] - current.target[2],
  ];
  const target: Vec3 = [x, 0, z];
  return {
    position: [x + offset[0], Math.max(MIN_CAMERA_Y, offset[1]), z + offset[2]],
    target,
  };
}

/**
 * The point a free-flying camera is "looking at": where its view ray meets the
 * ground within `maxDistance`, otherwise a point `fallbackDistance` ahead.
 */
export function lookTarget(
  position: Vec3,
  direction: Vec3,
  maxDistance: number,
  fallbackDistance: number,
): Vec3 {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const d: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  if (d[1] < -1e-3) {
    const t = -position[1] / d[1];
    if (t > 0 && t <= maxDistance) return [position[0] + d[0] * t, 0, position[2] + d[2] * t];
  }
  return [
    position[0] + d[0] * fallbackDistance,
    position[1] + d[1] * fallbackDistance,
    position[2] + d[2] * fallbackDistance,
  ];
}

const isFiniteVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Validates an externally supplied pose (share links are untrusted input):
 * finite numbers, distinct position/target, camera above the ground.
 */
export function sanitizePose(pose: CameraPose | null | undefined): CameraPose | null {
  if (!pose || !isFiniteVec3(pose.position) || !isFiniteVec3(pose.target)) return null;
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  if (Math.hypot(px - tx, py - ty, pz - tz) < 1e-6) return null;
  return { position: [px, Math.max(MIN_CAMERA_Y, py), pz], target: [tx, ty, tz] };
}

/** Rounds a pose for reporting (share links, minimap) to keep URLs short and stable. */
export function roundPose(pose: CameraPose, decimals = 2): CameraPose {
  const factor = 10 ** decimals;
  const round = (n: number) => Math.round(n * factor) / factor || 0;
  return {
    position: [round(pose.position[0]), round(pose.position[1]), round(pose.position[2])],
    target: [round(pose.target[0]), round(pose.target[1]), round(pose.target[2])],
  };
}

export function posesEqual(a: CameraPose | null, b: CameraPose | null, epsilon = 1e-3): boolean {
  if (!a || !b) return a === b;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs((a.position[i] ?? 0) - (b.position[i] ?? 0)) > epsilon) return false;
    if (Math.abs((a.target[i] ?? 0) - (b.target[i] ?? 0)) > epsilon) return false;
  }
  return true;
}

/** Orbit distance limits scaled to the world. */
export function distanceLimits(worldSize: number): { min: number; max: number } {
  const size = Math.max(1, worldSize);
  return { min: clamp(size * 0.004, 0.6, 8), max: size * 3.2 + 40 };
}

/** Camera clipping planes scaled to the world (keeps depth precision sane). */
export function clippingPlanes(worldSize: number): { near: number; far: number } {
  const size = Math.max(1, worldSize);
  return { near: clamp(size * 0.0006, 0.05, 2), far: size * 14 + 600 };
}
