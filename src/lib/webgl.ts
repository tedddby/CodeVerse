/**
 * WebGL capability detection.
 *
 * The explorer needs WebGL to render the 3D world. When it is unavailable
 * (disabled by policy, blocklisted GPU, headless browser, very old device) the
 * explorer falls back to the accessible text summary instead of a blank canvas.
 */

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

function releaseContext(context: GLContext): void {
  try {
    // Browsers cap the number of live WebGL contexts per page (~16). Explicitly
    // losing the probe context frees its slot for the real renderer.
    context.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Some drivers throw when the extension is queried on a lost context; nothing to free.
  }
}

function tryContext(
  canvas: HTMLCanvasElement,
  kind: "webgl2" | "webgl" | "experimental-webgl",
): GLContext | null {
  try {
    const context = canvas.getContext(kind, {
      failIfMajorPerformanceCaveat: false,
    }) as GLContext | null;
    return context && typeof context.getParameter === "function" ? context : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the browser can create a WebGL2 (preferred) or WebGL1
 * context. Always false during server rendering. The probe context is released
 * immediately.
 */
export function detectWebGL(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return false;
  }
  const context =
    tryContext(canvas, "webgl2") ??
    tryContext(canvas, "webgl") ??
    tryContext(canvas, "experimental-webgl");
  if (!context) return false;
  releaseContext(context);
  return true;
}
