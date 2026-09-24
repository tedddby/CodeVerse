import type { CameraControlsImpl } from "@react-three/drei";
import { PerspectiveCamera, Vector3, type Camera } from "three";
import type { CameraPose, NavigationMode } from "@/state/explorer-store";
import { bindCameraInput, type CameraInputHandlers } from "./camera-input";
import { Drone } from "./drone";
import { MOVEMENT_KEY_CODES } from "./flight";
import {
  CONTROL_ACTION,
  EMPTY_WORLD,
  applyWorldLimits,
  createOrbitControls,
  type WorldInfo,
} from "./orbit-controls";
import {
  MIN_CAMERA_Y,
  establishingPose,
  legalOrbitTarget,
  lookTarget,
  overviewPose,
  type Vec3,
  type ViewSpec,
} from "./poses";
import {
  createTween,
  easeInOutCubic,
  stepTween,
  transitionDuration,
  transitionLift,
  type PoseTween,
} from "./tween";

export { EMPTY_WORLD, type WorldInfo } from "./orbit-controls";

/**
 * Imperative camera controller behind <CameraRig>.
 *
 * - Orbit mode: camera-controls (see `orbit-controls.ts`).
 * - Explore mode: a free-flying drone (see `drone.ts`).
 * - Transitions: eased pose tweens (spherical around the moving target) that
 *   work in both modes and are cancelled by user input.
 * - Preview auto-rotation, paused while the user interacts.
 *
 * It holds no React state; the rig forwards store changes and the frame loop.
 */

/** Radians per second of the preview auto-orbit. */
const AUTO_ROTATE_SPEED = 0.07;
/** Idle time after user interaction before auto-orbit resumes. */
const AUTO_ROTATE_RESUME_SECONDS = 2.5;
/** Duration of the cinematic establishing shot. */
const INTRO_SECONDS = 1.9;
/** Duration of the turn toward a legal orbit target when leaving explore mode. */
const ORBIT_TURN_SECONDS = 0.6;
/**
 * Largest frame delta integrated at once: avoids jumps after a stalled tab,
 * while transitions still finish on time down to ~4 fps.
 */
const MAX_FRAME_DELTA = 0.25;

export class CameraController implements CameraInputHandlers {
  private readonly controls: CameraControlsImpl;
  private readonly drone: Drone;
  private mode: NavigationMode = "orbit";
  private world: WorldInfo = EMPTY_WORLD;
  private tween: PoseTween | null = null;
  private autoRotate = false;
  private reducedMotion = false;
  private userInteracting = false;
  private idleSeconds = Number.POSITIVE_INFINITY;
  private element: HTMLElement | null = null;
  private unbindInput: (() => void) | null = null;
  private active = false;
  private readonly scratch = new Vector3();

  /**
   * @param acceptKey decides whether a movement key event may drive the drone
   *   (e.g. not while typing or while a modal overlay is open).
   */
  constructor(
    private readonly camera: Camera,
    private readonly acceptKey: (event: KeyboardEvent) => boolean = () => true,
  ) {
    this.controls = createOrbitControls(camera);
    this.drone = new Drone(camera);
    applyWorldLimits(this.controls, camera, this.world);
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  setOptions(options: { autoRotate: boolean; reducedMotion: boolean }): void {
    this.autoRotate = options.autoRotate;
    this.reducedMotion = options.reducedMotion;
  }

  setWorld(world: WorldInfo | null): void {
    this.world = world ?? EMPTY_WORLD;
    applyWorldLimits(this.controls, this.camera, this.world);
  }

  getWorld(): WorldInfo {
    return this.world;
  }

  getMinDistance(): number {
    return this.controls.minDistance;
  }

  viewSpec(): ViewSpec {
    const camera = this.camera;
    return camera instanceof PerspectiveCamera
      ? { fovY: camera.getEffectiveFOV(), aspect: camera.aspect }
      : { fovY: 45, aspect: 1 };
  }

  // ─── Lifecycle & DOM wiring ───────────────────────────────────────────────

  /**
   * Starts listening to camera-controls events. Paired with `deactivate()`;
   * both are idempotent so React StrictMode double effects are harmless.
   */
  activate(): void {
    if (this.active) return;
    this.active = true;
    this.controls.addEventListener("controlstart", this.handleControlStart);
    this.controls.addEventListener("control", this.handleControl);
    this.controls.addEventListener("controlend", this.handleControlEnd);
  }

  /** Stops all listening (DOM and camera-controls). The controller can be activated again. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.detach();
    this.controls.removeEventListener("controlstart", this.handleControlStart);
    this.controls.removeEventListener("control", this.handleControl);
    this.controls.removeEventListener("controlend", this.handleControlEnd);
  }

  /** Enables user input on `element` (interactive canvases only). */
  attach(element: HTMLElement): void {
    if (this.element === element) return;
    this.detach();
    this.element = element;
    this.controls.connect(element);
    this.applyInputMode();
    this.unbindInput = bindCameraInput(element, this);
  }

  detach(): void {
    if (!this.element) return;
    this.controls.disconnect();
    this.unbindInput?.();
    this.unbindInput = null;
    this.element = null;
    this.drone.reset();
  }

  // ─── Modes ────────────────────────────────────────────────────────────────

  setMode(mode: NavigationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.drone.reset();
    if (mode === "explore") {
      this.drone.syncLook(this.cameraDirection());
    } else {
      // Orbit around what the drone was looking at. Looking level or up, that
      // point is outside the orbit's polar limits (the first drag would snap
      // the view), so turn smoothly toward a legal target instead.
      const position = this.cameraPosition();
      const looked = this.exploreTarget();
      const legal = this.orbitTarget();
      void this.controls.setLookAt(...position, ...looked, false);
      this.controls.update(0);
      if (!sameVec3(looked, legal)) this.turnTo({ position, target: legal });
    }
    this.applyInputMode();
  }

  /** camera-controls owns input in orbit mode; the drone handlers own it in explore mode. */
  private applyInputMode(): void {
    this.controls.enabled = this.mode === "orbit";
    // Disabling camera-controls clears touch-action; drag-to-look still needs it off.
    if (this.element && this.mode === "explore") this.element.style.touchAction = "none";
  }

  // ─── Poses & transitions ──────────────────────────────────────────────────

  /** The camera pose right now (target = orbit centre, or where the drone looks). */
  currentPose(): CameraPose {
    const position = this.cameraPosition();
    if (this.mode === "orbit") {
      this.controls.getTarget(this.scratch, false);
      return { position, target: [this.scratch.x, this.scratch.y, this.scratch.z] };
    }
    return { position, target: this.exploreTarget() };
  }

  /**
   * The pose to share (links, minimap). Same as `currentPose()`, except that
   * in explore mode the target is always one orbit mode can start from.
   */
  reportedPose(): CameraPose {
    if (this.mode === "orbit") return this.currentPose();
    return { position: this.cameraPosition(), target: this.orbitTarget() };
  }

  /** Moves to a pose immediately. */
  jumpTo(pose: CameraPose): void {
    this.tween = null;
    this.drone.haltMomentum();
    this.applyPose(pose);
    this.finishPose();
  }

  /** Flies to a pose (instantly with reduced motion or `animate = false`). */
  flyTo(pose: CameraPose, animate = true): void {
    if (!animate || this.reducedMotion) {
      this.jumpTo(pose);
      return;
    }
    const from = this.currentPose();
    // A flight owns the camera: drop any drone momentum so it does not resume afterwards.
    this.drone.haltMomentum();
    this.tween = createTween(from, pose, transitionDuration(from, pose, this.world.size), {
      lift: transitionLift(from, pose),
    });
  }

  /** A short turn in place (no fly-to arc); instant with reduced motion. */
  private turnTo(pose: CameraPose): void {
    if (this.reducedMotion) {
      this.jumpTo(pose);
      return;
    }
    this.drone.haltMomentum();
    this.tween = createTween(this.currentPose(), pose, ORBIT_TURN_SECONDS);
  }

  /** Cinematic establishing shot: high and far, easing down into the 3/4 overview. */
  playIntro(): void {
    const view = this.viewSpec();
    const overview = overviewPose(this.world.frame, view);
    if (this.reducedMotion) {
      this.jumpTo(overview);
      return;
    }
    this.jumpTo(establishingPose(this.world.frame, view));
    this.tween = createTween(this.currentPose(), overview, INTRO_SECONDS, { ease: easeInOutCubic });
  }

  // ─── Frame loop ───────────────────────────────────────────────────────────

  update(rawDelta: number): void {
    const delta = Math.min(Math.max(0, rawDelta), MAX_FRAME_DELTA);
    if (!this.userInteracting) this.idleSeconds += delta;

    if (this.tween) {
      const { pose, done } = stepTween(this.tween, delta);
      this.applyPose(pose);
      if (done) {
        this.tween = null;
        this.finishPose();
      }
    } else if (this.mode === "explore") {
      this.drone.update(delta, { size: this.world.size, center: this.world.frame.center });
    } else if (
      this.autoRotate &&
      !this.reducedMotion &&
      !this.userInteracting &&
      this.idleSeconds >= AUTO_ROTATE_RESUME_SECONDS
    ) {
      void this.controls.rotate(AUTO_ROTATE_SPEED * delta, 0, false);
    }

    if (this.mode === "orbit") this.controls.update(delta);
  }

  private applyPose(pose: CameraPose): void {
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    if (this.mode === "orbit") {
      void this.controls.setLookAt(px, py, pz, tx, ty, tz, false);
    } else {
      this.camera.position.set(px, Math.max(MIN_CAMERA_Y, py), pz);
      this.camera.lookAt(tx, ty, tz);
    }
  }

  private finishPose(): void {
    if (this.mode === "orbit") this.controls.update(0);
    else this.drone.syncLook(this.cameraDirection());
  }

  private cameraPosition(): Vec3 {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }

  private cameraDirection(): Vec3 {
    this.camera.getWorldDirection(this.scratch);
    return [this.scratch.x, this.scratch.y, this.scratch.z];
  }

  /** What the drone looks at: its ground hit, or a point ahead scaled to altitude. */
  private exploreTarget(): Vec3 {
    const position = this.cameraPosition();
    return lookTarget(
      position,
      this.cameraDirection(),
      this.world.size * 3,
      this.lookFallbackDistance(position),
    );
  }

  /** Where orbit mode can take over from the drone without clamping (see `legalOrbitTarget`). */
  private orbitTarget(): Vec3 {
    const position = this.cameraPosition();
    return legalOrbitTarget(position, this.cameraDirection(), {
      maxDistance: this.world.size * 3,
      fallbackDistance: this.lookFallbackDistance(position),
      minDistance: this.controls.minDistance,
      worldSize: this.world.size,
    });
  }

  private lookFallbackDistance(position: Vec3): number {
    const altitude = Math.max(MIN_CAMERA_Y, position[1]);
    return Math.min(this.world.size * 0.5, Math.max(this.controls.minDistance * 4, altitude * 1.5));
  }

  private markUserInput(): void {
    this.tween = null;
    this.idleSeconds = 0;
  }

  // ─── Event handlers (arrow functions keep `this` bound for add/removeEventListener) ─

  private readonly handleControlStart = () => {
    this.userInteracting = true;
    this.markUserInput();
  };

  private readonly handleControl = () => {
    // Wheel dollies only emit "control"; any user control cancels a running transition.
    this.markUserInput();
  };

  private readonly handleControlEnd = () => {
    this.userInteracting = false;
    this.idleSeconds = 0;
  };

  readonly onPointerDownCapture = (event: PointerEvent) => {
    if (this.mode !== "orbit") return;
    this.controls.mouseButtons.left = event.shiftKey ? CONTROL_ACTION.TRUCK : CONTROL_ACTION.ROTATE;
  };

  readonly onPointerDown = (event: PointerEvent) => {
    if (this.mode !== "explore") return;
    this.drone.beginLook(event.pointerId, event.clientX, event.clientY);
    this.userInteracting = true;
  };

  readonly onPointerMove = (event: PointerEvent) => {
    if (this.mode !== "explore") return;
    if (this.drone.moveLook(event.pointerId, event.clientX, event.clientY)) this.markUserInput();
  };

  readonly onPointerUp = (event: PointerEvent) => {
    if (!this.drone.endLook(event.pointerId)) return;
    this.userInteracting = false;
    this.idleSeconds = 0;
  };

  readonly onWheel = (event: WheelEvent) => {
    if (this.mode !== "explore") return;
    event.preventDefault();
    this.markUserInput();
    this.drone.wheel(event.deltaY, event.deltaMode, this.world.size);
  };

  readonly onContextMenu = (event: MouseEvent) => {
    // Right-drag looks around in explore mode; do not pop the browser menu on release.
    if (this.mode === "explore") event.preventDefault();
  };

  readonly onKeyDown = (event: KeyboardEvent) => {
    if (!MOVEMENT_KEY_CODES.has(event.code)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.mode !== "explore" || !this.acceptKey(event)) return;
    this.drone.pressKey(event.code);
    this.markUserInput();
    // Arrow keys would otherwise scroll the page.
    if (event.code.startsWith("Arrow")) event.preventDefault();
  };

  readonly onKeyUp = (event: KeyboardEvent) => {
    this.drone.releaseKey(event.code);
  };

  readonly onBlur = () => {
    this.drone.clearKeys();
  };
}

function sameVec3(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}
