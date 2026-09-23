/**
 * Geometry of the CodeVerse mark, shared by the React logo, the generated
 * app icons and the Open Graph image so every rendition stays identical.
 *
 * The mark is a "building" drawn in 2:1 pixel isometric (every vertex lands on
 * an integer at 32px and 16px, which keeps the favicon crisp) with an orbit
 * ring passing through it: files are buildings, the repository is a universe.
 *
 * Coordinates live in a 32 x 32 view box.
 */

export const LOGO_VIEWBOX = 32;

/** Brand palette (mirrors the design tokens in globals.css). */
export const BRAND_COLORS = {
  void: "#04060b",
  panel: "#0b111c",
  ink: "#e7edf5",
  inkMuted: "#9aa8bb",
  signal: "#4de2ff",
  signalDim: "#1b7f99",
  ion: "#9b8cff",
} as const;

/** Faces of the tower, as SVG path data. */
export const LOGO_FACES = {
  top: "M16 6 24 10 16 14 8 10Z",
  left: "M8 10 16 14 16 26 8 22Z",
  right: "M16 14 24 10 24 22 16 26Z",
} as const;

/**
 * The orbit ring: an axis-aligned ellipse centerd on the tower. `strokeWidth`
 * suits UI sizes (24px and up); favicon-sized renditions use `smallStrokeWidth`
 * so the ring lands on whole pixels at 16px and 32px.
 */
export const LOGO_ORBIT = {
  cx: 16,
  cy: 16,
  rx: 14.5,
  ry: 4.5,
  strokeWidth: 1.5,
  smallStrokeWidth: 2,
} as const;

/** Front (lower) half of the orbit, drawn over the tower. */
export const LOGO_ORBIT_FRONT = "M1.5 16A14.5 4.5 0 0 0 30.5 16";

/**
 * The part of the front arc that overlaps the tower (x = 8..24). It is stroked
 * wider in the background color first so the ring reads as passing in front.
 */
export const LOGO_ORBIT_KNOCKOUT = "M8 19.753A14.5 4.5 0 0 0 24 19.753";

/** A satellite riding the front of the orbit. */
export const LOGO_SATELLITE = { cx: 27.5, cy: 18.74, r: 1.7 } as const;
