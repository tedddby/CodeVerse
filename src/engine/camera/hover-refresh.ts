/**
 * Keeps hover honest while the camera moves under a resting pointer.
 *
 * R3F only raycasts on pointer events, so after a wheel zoom, a flight
 * (search, minimap, reset) or explore-mode WASD the hovered object and its
 * tooltip would stay on a building that is no longer under the cursor. The
 * camera rig asks `frame()` every frame whether to replay the last pointer
 * event (`events.update()`): at most `intervalSeconds` apart while the view
 * moves, once more after it settles, and never while the pointer is outside
 * the canvas or a button is held (drags suspend hover anyway).
 */

/** Hover re-evaluations while the camera moves: at most 10 per second. */
export const HOVER_REFRESH_INTERVAL = 0.1;

function pressedButtons(event: Event): number {
  return "buttons" in event && typeof event.buttons === "number" ? event.buttons : 0;
}

export class HoverRefresh {
  private dirty = false;
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private inside = false;
  private pressed = false;

  constructor(private readonly intervalSeconds = HOVER_REFRESH_INTERVAL) {}

  /** Tracks the pointer on the canvas event source; returns the cleanup. */
  bind(element: EventTarget, windowTarget: EventTarget): () => void {
    const onMove = (event: Event) => {
      this.inside = true;
      this.pressed = pressedButtons(event) !== 0;
    };
    const onLeave = () => {
      this.inside = false;
    };
    const onDown = () => {
      this.pressed = true;
    };
    const onUp = () => {
      this.pressed = false;
    };
    element.addEventListener("pointerenter", onMove);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("pointerdown", onDown);
    windowTarget.addEventListener("pointerup", onUp);
    windowTarget.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerenter", onMove);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("pointerdown", onDown);
      windowTarget.removeEventListener("pointerup", onUp);
      windowTarget.removeEventListener("pointercancel", onUp);
    };
  }

  /** Call once per frame with the clock time and whether the view changed; true = re-raycast now. */
  frame(now: number, viewChanged: boolean): boolean {
    if (viewChanged) this.dirty = true;
    if (!this.dirty || !this.inside || this.pressed) return false;
    if (now - this.lastRefresh < this.intervalSeconds) return false;
    this.dirty = false;
    this.lastRefresh = now;
    return true;
  }
}
