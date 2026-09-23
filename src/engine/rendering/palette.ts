/**
 * Scene palette and small color-math helpers.
 *
 * Hex values mirror the design tokens in `src/app/globals.css` so the 3D world
 * and the DOM chrome read as one product. Shaders work in linear RGB, so every
 * color that reaches a GPU buffer goes through `hexToLinear()` first.
 */

export type Rgb = readonly [number, number, number];

export const SCENE_HEX = {
  void: "#04060b",
  abyss: "#070b13",
  panel: "#0b111c",
  panelRaised: "#101828",
  line: "#1a2434",
  lineStrong: "#2a3850",
  ink: "#e7edf5",
  inkMuted: "#9aa8bb",
  inkSubtle: "#627089",
  signal: "#4de2ff",
  signalDim: "#1b7f99",
  ion: "#9b8cff",
  /** Reserved for selection. Never used to encode data. */
  flare: "#ffb454",
  ok: "#3ddc97",
  warn: "#ffcc66",
  danger: "#ff6b7a",
} as const;

/** Colors used only by the renderer (not design tokens). */
export const RENDER_HEX = {
  /** Neutral building body used when a mode has nothing to say about a file. */
  neutral: "#3a4556",
  /** Slightly brighter neutral for "has data but not highlighted". */
  neutralBright: "#5b6a80",
  /** Binary files: low grey slabs. */
  binary: "#4a5260",
  /** Files with dependencies in both directions relative to the selection. */
  mutual: "#79b8ff",
  /** Ground plane. */
  ground: "#05080f",
  /** Grid lines. */
  gridCell: "#0f1826",
  gridSection: "#1a2a40",
} as const;

/** Symbol kind colors for bands on building facades. */
export const SYMBOL_KIND_HEX = {
  structure: "#9b8cff",
  callable: "#4de2ff",
  typeLike: "#6fdca8",
  value: "#c9a567",
  module: "#7d8aa3",
} as const;

/** Activity heat ramp: cold slate -> signal cyan -> near-white. */
export const ACTIVITY_RAMP: readonly string[] = ["#1c2533", "#1b5f78", "#4de2ff", "#c4f5ff"];

/** Complexity ramp: calm teal -> amber -> hot red-magenta. */
export const COMPLEXITY_RAMP: readonly string[] = [
  "#1f6f78",
  "#3fb6a8",
  "#e8b04a",
  "#ff5a6e",
  "#ff3fa4",
];

/**
 * Categorical palette for the top contributors. Deliberately avoids the flare
 * amber hue, which is reserved for selection.
 */
export const CONTRIBUTOR_PALETTE: readonly string[] = [
  "#4de2ff",
  "#9b8cff",
  "#3ddc97",
  "#ff6fa8",
  "#c8e25a",
  "#5b8def",
  "#e07bff",
  "#6fb3a8",
];

/** sRGB transfer function -> linear, per channel (0..1). */
export function srgbChannelToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Parses "#rgb" / "#rrggbb" into sRGB components 0..1. Invalid input yields mid grey. */
export function hexToSrgb(hex: string): Rgb {
  let value = hex.trim().replace(/^#/, "");
  if (value.length === 3) value = value.replace(/(.)/g, "$1$1");
  if (!/^[0-9a-f]{6}$/i.test(value)) return [0.5, 0.5, 0.5];
  const int = Number.parseInt(value, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

const linearCache = new Map<string, Rgb>();

/** Hex (sRGB) -> linear RGB, memoized. */
export function hexToLinear(hex: string): Rgb {
  const cached = linearCache.get(hex);
  if (cached) return cached;
  const [r, g, b] = hexToSrgb(hex);
  const linear: Rgb = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  linearCache.set(hex, linear);
  return linear;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function scaleRgb(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/** Relative luminance of a linear color. */
export function luminance(color: Rgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/** Moves a linear color toward its own luminance grey by `amount` (0..1). */
export function desaturate(color: Rgb, amount: number): Rgb {
  const grey = luminance(color);
  return mixRgb(color, [grey, grey, grey], amount);
}

/**
 * Samples a multi-stop ramp (hex stops, evenly spaced) at t in 0..1 and returns
 * a linear color. Interpolation happens in linear space.
 */
export function sampleRamp(stops: readonly string[], t: number): Rgb {
  if (stops.length === 0) return [0.5, 0.5, 0.5];
  const first = stops[0] ?? "#808080";
  if (stops.length === 1) return hexToLinear(first);
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const from = hexToLinear(stops[index] ?? first);
  const to = hexToLinear(stops[index + 1] ?? first);
  return mixRgb(from, to, scaled - index);
}
