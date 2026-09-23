import { Euler, type Camera } from "three";
import {
  LOOK_SENSITIVITY,
  clampPitch,
  constrainPosition,
  dampVelocity,
  desiredVelocity,
  flightSpeed,
  forwardVector,
  movementFromKeys,
  wheelImpulse,
  wheelPixels,
  yawPitchFromDirection,
} from "./flight";
import type { Vec3 } from "./poses";

/**
 * Explore-mode "drone": free flight over the city. Movement keys set a
 * desired velocity on the horizontal plane (relative to the heading) plus
 * up/down; the actual velocity eases toward it. Dragging looks around (no
 * pointer lock); the wheel adds a glide impulse along the view direction.
 */

/** Velocity smoothing (1/s). */
const RESPONSIVENESS = 8;

export interface DroneWorld {
  size: number;
  center: Vec3;
}

export class Drone {
  private yaw = 0;
  private pitch = 0;
  private velocity: Vec3 = [0, 0, 0];
  private readonly keys = new Set<string>();
  private look: { pointerId: number; x: number; y: number } | null = null;
  private orientationDirty = false;
  private readonly euler = new Euler(0, 0, 0, "YXZ");

  constructor(private readonly camera: Camera) {}

  /** Adopts a viewing direction (entering explore mode, or after a transition). */
  syncLook(direction: Vec3): void {
    const { yaw, pitch } = yawPitchFromDirection(direction);
    this.yaw = yaw;
    this.pitch = pitch;
    this.orientationDirty = true;
  }

  /** Drops momentum (a camera transition takes over). */
  haltMomentum(): void {
    this.velocity = [0, 0, 0];
  }

  /** Forgets all input state (mode switch, detach, window blur). */
  reset(): void {
    this.velocity = [0, 0, 0];
    this.keys.clear();
    this.look = null;
  }

  pressKey(code: string): void {
    this.keys.add(code);
  }

  releaseKey(code: string): void {
    this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
    this.look = null;
  }

  beginLook(pointerId: number, x: number, y: number): void {
    this.look = { pointerId, x, y };
  }

  /** Returns true when the view direction changed. */
  moveLook(pointerId: number, x: number, y: number): boolean {
    const look = this.look;
    if (!look || look.pointerId !== pointerId) return false;
    const dx = x - look.x;
    const dy = y - look.y;
    if (dx === 0 && dy === 0) return false;
    this.look = { pointerId, x, y };
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = clampPitch(this.pitch - dy * LOOK_SENSITIVITY);
    this.orientationDirty = true;
    return true;
  }

  /** Returns true when this pointer was driving the look. */
  endLook(pointerId: number): boolean {
    if (!this.look || this.look.pointerId !== pointerId) return false;
    this.look = null;
    return true;
  }

  /** Adds a glide impulse for a wheel gesture (scroll up = forward). */
  wheel(deltaY: number, deltaMode: number, worldSize: number): void {
    const speed = flightSpeed(worldSize, this.camera.position.y, false);
    const impulse = wheelImpulse(wheelPixels(deltaY, deltaMode), speed, RESPONSIVENESS);
    const direction = forwardVector(this.yaw, this.pitch);
    this.velocity = [
      this.velocity[0] + direction[0] * impulse,
      this.velocity[1] + direction[1] * impulse,
      this.velocity[2] + direction[2] * impulse,
    ];
  }

  /** Integrates one frame: eases velocity, moves (never below the ground), applies the look. */
  update(delta: number, world: DroneWorld): void {
    const input = movementFromKeys(this.keys);
    const speed = flightSpeed(world.size, this.camera.position.y, input.boost);
    this.velocity = dampVelocity(
      this.velocity,
      desiredVelocity(input, this.yaw, speed),
      delta,
      RESPONSIVENESS,
    );
    const [vx, vy, vz] = this.velocity;
    if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) > 1e-4) {
      const position = this.camera.position;
      const next = constrainPosition(
        [position.x + vx * delta, position.y + vy * delta, position.z + vz * delta],
        world.center,
        world.size * 3 + 200,
      );
      position.set(next[0], next[1], next[2]);
    } else if (vx !== 0 || vy !== 0 || vz !== 0) {
      this.velocity = [0, 0, 0];
    }
    if (this.orientationDirty) {
      this.euler.set(this.pitch, this.yaw, 0, "YXZ");
      this.camera.quaternion.setFromEuler(this.euler);
      this.orientationDirty = false;
    }
  }
}
