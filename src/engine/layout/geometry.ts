/**
 * Small geometry helpers shared by the layout modules.
 * Rectangles here are described by their minimum corner (x, z) and extents,
 * which is convenient for subdivision; the public `WorldLayout` uses centres.
 */

/** Axis-aligned rectangle on the XZ ground plane, anchored at its minimum corner. */
export interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** Tolerance used for floating-point containment comparisons inside the engine. */
export const GEOMETRY_EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Shrinks a rectangle by `amount` on every side. The inset is limited to a
 * quarter of the smaller side so a degenerate slot never yields a negative size.
 */
export function insetRect(rect: Rect, amount: number): Rect {
  const inset = Math.max(0, Math.min(amount, rect.width / 4, rect.depth / 4));
  return {
    x: rect.x + inset,
    z: rect.z + inset,
    width: rect.width - 2 * inset,
    depth: rect.depth - 2 * inset,
  };
}

/**
 * Rounds a world coordinate to 1/1000 of a unit. Keeps serialized layouts
 * compact and stable while staying far below every gap used by the engine.
 * Normalizes -0 to 0 so equality checks and JSON output are canonical.
 */
export function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Locale-independent string ordering (UTF-16 code units). `localeCompare`
 * depends on the host's ICU data and must not influence a deterministic layout.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Non-negative finite number, or 0 for anything else (NaN, Infinity, negatives, non-numbers). */
export function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Monotonic clock for `durationMs`; never feeds into layout geometry. */
export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
