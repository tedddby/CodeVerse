import type { CameraPose } from "@/state/explorer-store";
import { MIN_CAMERA_Y, poseFromSpherical, sphericalOf, type Vec3 } from "./poses";

/**
 * Camera transitions. Poses are interpolated around the (moving) target in
 * spherical coordinates, so the camera sweeps around rather than cutting
 * through buildings, keeps a sensible elevation, and zooms geometrically.
 * Long flights pull back mid-way ("fly-to" arc) to keep the viewer oriented.
 */

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Shortest signed angular difference b - a, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

export interface InterpolationOptions {
  /** Mid-flight pull-back as a fraction of distance (0 = none). */
  lift?: number;
}

/**
 * Pose at progress `t` (0..1, already eased) between `from` and `to`.
 * `t = 0` returns `from` and `t = 1` returns `to` exactly.
 */
export function interpolatePose(
  from: CameraPose,
  to: CameraPose,
  t: number,
  options: InterpolationOptions = {},
): CameraPose {
  if (t <= 0) return clonePose(from);
  if (t >= 1) return clonePose(to);
  const a = sphericalOf(from);
  const b = sphericalOf(to);
  const target: Vec3 = [
    from.target[0] + (to.target[0] - from.target[0]) * t,
    from.target[1] + (to.target[1] - from.target[1]) * t,
    from.target[2] + (to.target[2] - from.target[2]) * t,
  ];
  const d0 = Math.max(a.distance, 1e-6);
  const d1 = Math.max(b.distance, 1e-6);
  const lift = Math.max(0, options.lift ?? 0);
  const distance = d0 * Math.pow(d1 / d0, t) * (1 + lift * Math.sin(Math.PI * t));
  // Linear polar interpolation stays between the two end elevations, so an
  // arc between two above-ground poses never dips under the target's horizon.
  const polar = a.polar + (b.polar - a.polar) * t;
  const azimuth = a.azimuth + angleDelta(a.azimuth, b.azimuth) * t;
  const pose = poseFromSpherical(target, { distance, polar, azimuth });
  pose.position[1] = Math.max(MIN_CAMERA_Y, pose.position[1]);
  return pose;
}

export function clonePose(pose: CameraPose): CameraPose {
  return {
    position: [pose.position[0], pose.position[1], pose.position[2]],
    target: [pose.target[0], pose.target[1], pose.target[2]],
  };
}

function targetTravel(from: CameraPose, to: CameraPose): number {
  return Math.hypot(
    to.target[0] - from.target[0],
    to.target[1] - from.target[1],
    to.target[2] - from.target[2],
  );
}

/** Transition duration in seconds: ~0.9 s for short hops, up to 1.2 s across the world. */
export function transitionDuration(from: CameraPose, to: CameraPose, worldSize: number): number {
  const travel = targetTravel(from, to);
  const zoom = Math.abs(
    Math.log(Math.max(sphericalOf(to).distance, 1e-3) / Math.max(sphericalOf(from).distance, 1e-3)),
  );
  const normalized = travel / Math.max(1, worldSize) + zoom * 0.08;
  return Math.min(1.2, 0.9 + normalized * 0.4);
}

/** Pull-back factor for a transition: grows with travel relative to the framing distances. */
export function transitionLift(from: CameraPose, to: CameraPose): number {
  const travel = targetTravel(from, to);
  const reference = sphericalOf(from).distance + sphericalOf(to).distance;
  if (reference <= 0) return 0;
  return Math.min(0.6, Math.max(0, (travel / reference - 0.35) * 0.6));
}

/** A running camera transition. `elapsed` and `duration` are in seconds. */
export interface PoseTween {
  from: CameraPose;
  to: CameraPose;
  duration: number;
  elapsed: number;
  lift: number;
  ease: (t: number) => number;
}

export function createTween(
  from: CameraPose,
  to: CameraPose,
  duration: number,
  options: { lift?: number; ease?: (t: number) => number } = {},
): PoseTween {
  return {
    from: clonePose(from),
    to: clonePose(to),
    duration: Math.max(0, duration),
    elapsed: 0,
    lift: options.lift ?? 0,
    ease: options.ease ?? easeInOutCubic,
  };
}

/** Advances a tween by `delta` seconds; returns the pose and whether it finished. */
export function stepTween(tween: PoseTween, delta: number): { pose: CameraPose; done: boolean } {
  tween.elapsed += Math.max(0, delta);
  if (tween.duration <= 0 || tween.elapsed >= tween.duration)
    return { pose: clonePose(tween.to), done: true };
  const t = tween.ease(tween.elapsed / tween.duration);
  return { pose: interpolatePose(tween.from, tween.to, t, { lift: tween.lift }), done: false };
}
