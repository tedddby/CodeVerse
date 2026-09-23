/**
 * DOM input wiring for the camera: pointer and wheel on the canvas' event
 * element, movement keys and focus loss on the window. Kept separate from
 * the controller so listener bookkeeping lives in exactly one place.
 */
export interface CameraInputHandlers {
  /** Capture phase, before camera-controls reads the pressed buttons. */
  onPointerDownCapture: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onWheel: (event: WheelEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onBlur: () => void;
}

/** Registers the handlers; returns a function removing every listener it added. */
export function bindCameraInput(element: HTMLElement, handlers: CameraInputHandlers): () => void {
  element.addEventListener("pointerdown", handlers.onPointerDownCapture, { capture: true });
  element.addEventListener("pointerdown", handlers.onPointerDown);
  element.addEventListener("wheel", handlers.onWheel, { passive: false });
  element.addEventListener("contextmenu", handlers.onContextMenu);
  window.addEventListener("pointermove", handlers.onPointerMove);
  window.addEventListener("pointerup", handlers.onPointerUp);
  window.addEventListener("pointercancel", handlers.onPointerUp);
  window.addEventListener("keydown", handlers.onKeyDown);
  window.addEventListener("keyup", handlers.onKeyUp);
  window.addEventListener("blur", handlers.onBlur);
  return () => {
    element.removeEventListener("pointerdown", handlers.onPointerDownCapture, { capture: true });
    element.removeEventListener("pointerdown", handlers.onPointerDown);
    element.removeEventListener("wheel", handlers.onWheel);
    element.removeEventListener("contextmenu", handlers.onContextMenu);
    window.removeEventListener("pointermove", handlers.onPointerMove);
    window.removeEventListener("pointerup", handlers.onPointerUp);
    window.removeEventListener("pointercancel", handlers.onPointerUp);
    window.removeEventListener("keydown", handlers.onKeyDown);
    window.removeEventListener("keyup", handlers.onKeyUp);
    window.removeEventListener("blur", handlers.onBlur);
  };
}
