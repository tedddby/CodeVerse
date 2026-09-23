import { MIN_CAMERA_Y, type Vec3 } from "./poses";

/**
 * Explore-mode ("drone") flight model. Pure math: key state -> desired
 * velocity, exponential velocity smoothing, look angles. The camera rig wires
 * it to keyboard/pointer events and applies it to the three.js camera.
 *
 * Angles follow three.js Euler "YXZ" for a camera: yaw rotates about +Y
 * (0 = looking toward -Z), pitch about the camera's X axis (+ = up).
 */

/** KeyboardEvent.code values for continuous movement (layout-independent). */
export const MOVEMENT_KEY_CODES: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

export interface MovementInput {
  /** -1 (back) .. 1 (forward), horizontal. */
  forward: number;
  /** -1 (left) .. 1 (right). */
  right: number;
  /** -1 (down) .. 1 (up). */
  up: number;
  boost: boolean;
}

export const BOOST_MULTIPLIER = 3;
/** Radians of rotation per dragged pixel. */
export const LOOK_SENSITIVITY = 0.0032;
/** Keep a little away from straight up/down to avoid gimbal flips. */
export const MAX_PITCH = Math.PI / 2 - 0.05;

export function movementFromKeys(pressed: ReadonlySet<string>): MovementInput {
  const has = (...codes: string[]) => codes.some((code) => pressed.has(code));
  return {
    forward: Number(has("KeyW", "ArrowUp")) - Number(has("KeyS", "ArrowDown")),
    right: Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft")),
    up: Number(has("KeyE")) - Number(has("KeyQ")),
    boost: has("ShiftLeft", "ShiftRight"),
  };
}

export function isIdle(input: MovementInput): boolean {
  return input.forward === 0 && input.right === 0 && input.up === 0;
}

/**
 * Cruise speed in world units per second: proportional to the world so small
 * and huge repositories feel alike, and faster at altitude so climbing out for
 * an overview does not crawl.
 */
export function flightSpeed(worldSize: number, altitude: number, boost: boolean): number {
  const size = Math.max(1, worldSize);
  const base = Math.min(40, Math.max(1.5, size * 0.02));
  const speed = Math.min(size * 0.6 + 10, base + Math.max(0, altitude) * 0.8);
  return speed * (boost ? BOOST_MULTIPLIER : 1);
}

export function forwardVector(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
}

export function yawPitchFromDirection(direction: Vec3): { yaw: number; pitch: number } {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const y = Math.min(1, Math.max(-1, direction[1] / length));
  return { yaw: Math.atan2(-direction[0], -direction[2]), pitch: clampPitch(Math.asin(y)) };
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
}

/**
 * Desired velocity for the input: forward/strafe on the horizontal plane
 * relative to the heading (looking down never makes W dive), up/down on Y.
 * Diagonals are normalized so they are not faster.
 */
export function desiredVelocity(input: MovementInput, yaw: number, speed: number): Vec3 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let x = -sin * input.forward + cos * input.right;
  let z = -cos * input.forward - sin * input.right;
  let y = input.up;
  const length = Math.hypot(x, y, z);
  if (length > 1) {
    x /= length;
    y /= length;
    z /= length;
  }
  return [x * speed, y * speed, z * speed];
}

/** Frame-rate independent exponential approach of `current` toward `desired`. */
export function dampVelocity(
  current: Vec3,
  desired: Vec3,
  delta: number,
  responsiveness = 8,
): Vec3 {
  const k = 1 - Math.exp(-Math.max(0, delta) * responsiveness);
  return [
    current[0] + (desired[0] - current[0]) * k,
    current[1] + (desired[1] - current[1]) * k,
    current[2] + (desired[2] - current[2]) * k,
  ];
}

/** Normalizes a wheel delta to pixels (line and page modes use browser-typical sizes). */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.max(-400, Math.min(400, pixels));
}

/**
 * Velocity impulse (world units/second along the view direction) for a wheel
 * gesture. One ~100px notch glides roughly a third of a second of cruise.
 */
export function wheelImpulse(pixels: number, speed: number, responsiveness = 8): number {
  return -pixels * 0.0035 * speed * responsiveness;
}

/** Applies the altitude floor and an overall roaming radius around the world centre. */
export function constrainPosition(position: Vec3, center: Vec3, roamRadius: number): Vec3 {
  let [x, y, z] = position;
  y = Math.max(MIN_CAMERA_Y, Math.min(y, roamRadius));
  const dx = x - center[0];
  const dz = z - center[2];
  const horizontal = Math.hypot(dx, dz);
  if (horizontal > roamRadius && horizontal > 0) {
    x = center[0] + (dx / horizontal) * roamRadius;
    z = center[2] + (dz / horizontal) * roamRadius;
  }
  return [x, y, z];
}
