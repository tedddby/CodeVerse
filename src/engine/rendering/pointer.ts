/**
 * Pointer helpers shared by pickable layers.
 */

/** Clicks whose pointer travelled further than this (px) were drags (orbit/look), not picks. */
export const CLICK_DRAG_TOLERANCE_PX = 4;

export function isDragClick(delta: number): boolean {
  return !Number.isFinite(delta) || delta > CLICK_DRAG_TOLERANCE_PX;
}

export interface Scheduler {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Leading + trailing throttle for high-frequency values (hover under a moving
 * pointer): the first change applies immediately, later changes at most every
 * `intervalMs`, and the latest value always lands eventually. Identical
 * consecutive values are not re-applied.
 */
export class ThrottledValue<T> {
  private lastApplied: { value: T } | null = null;
  private pending: { value: T } | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly intervalMs: number,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {}

  set(value: T): void {
    this.pending = { value };
    const elapsed = this.scheduler.now() - this.lastTime;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = this.scheduler.setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.intervalMs - elapsed);
    }
  }

  /** Applies the pending value now (if it differs from the last applied one). */
  flush(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    this.lastTime = this.scheduler.now();
    if (this.lastApplied && this.equals(this.lastApplied.value, pending.value)) return;
    this.lastApplied = { value: pending.value };
    this.apply(pending.value);
  }

  /** Forgets what was applied, so the next value is applied even if it is equal. */
  reset(): void {
    this.lastApplied = null;
  }

  dispose(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

/**
 * Hover channel shared by pickable layers: throttles writes and can be
 * suspended (while the user drags the camera) so hover state and tooltips do
 * not flicker across buildings sweeping under a moving pointer.
 */
export class HoverChannel<T> {
  private suspended = false;

  constructor(private readonly throttled: ThrottledValue<T | null>) {}

  set(value: T | null): void {
    this.throttled.set(this.suspended ? null : value);
  }

  /** While suspended every hover reads as "nothing"; suspending clears the current hover immediately. */
  suspend(value: boolean): void {
    if (this.suspended === value) return;
    this.suspended = value;
    if (value) {
      this.throttled.set(null);
      this.throttled.flush();
    }
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  dispose(): void {
    this.throttled.dispose();
  }
}

/**
 * Suspends a hover channel while a pointer drag (beyond the click tolerance)
 * is in progress on `element`. Returns a cleanup function.
 */
export function suspendHoverWhileDragging(
  element: HTMLElement,
  channel: Pick<HoverChannel<unknown>, "suspend" | "isSuspended">,
): () => void {
  let origin: { id: number; x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    origin = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onMove = (event: PointerEvent) => {
    if (!origin || origin.id !== event.pointerId || channel.isSuspended()) return;
    const travelled = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (travelled > CLICK_DRAG_TOLERANCE_PX) channel.suspend(true);
  };
  const onUp = (event: PointerEvent) => {
    if (origin && origin.id !== event.pointerId) return;
    origin = null;
    channel.suspend(false);
  };
  element.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}
