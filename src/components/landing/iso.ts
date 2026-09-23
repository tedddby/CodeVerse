/**
 * Tiny isometric projection helpers for the landing page's static SVG artwork
 * (demo poster, pipeline diagrams, feature illustrations).
 *
 * World axes follow the 3D engine: the ground is the XZ plane and +Y is up.
 * The viewer looks from +X/+Z towards the origin, so larger x + z is closer.
 */

const COS_30 = Math.cos(Math.PI / 6);
const SIN_30 = 0.5;

export interface IsoPoint {
  x: number;
  y: number;
}

/** Projects a world point to screen space (y grows downwards, like SVG). */
export function projectIso(x: number, y: number, z: number, scale = 1): IsoPoint {
  return { x: (x - z) * COS_30 * scale, y: ((x + z) * SIN_30 - y) * scale };
}

/** An axis-aligned box described by its footprint center and extents. */
export interface IsoBox {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Y of the bottom face (defaults to 0). */
  baseY?: number;
}

/** SVG `points` strings for the three faces visible from the viewer. */
export interface IsoFaces {
  top: string;
  /** Face at maximum z (lower left on screen). */
  left: string;
  /** Face at maximum x (lower right on screen). */
  right: string;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPoints(points: IsoPoint[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

export function isoFaces(box: IsoBox, scale = 1): IsoFaces {
  const x0 = box.x - box.width / 2;
  const x1 = box.x + box.width / 2;
  const z0 = box.z - box.depth / 2;
  const z1 = box.z + box.depth / 2;
  const y0 = box.baseY ?? 0;
  const y1 = y0 + box.height;
  const p = (x: number, y: number, z: number) => projectIso(x, y, z, scale);
  return {
    top: toPoints([p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)]),
    left: toPoints([p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z1), p(x0, y0, z1)]),
    right: toPoints([p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), p(x1, y0, z0)]),
  };
}

/** Screen-space bounding box of a set of boxes (useful for SVG view boxes). */
export function isoBounds(boxes: readonly IsoBox[], scale = 1) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const y0 = box.baseY ?? 0;
    for (const dx of [-0.5, 0.5]) {
      for (const dz of [-0.5, 0.5]) {
        for (const y of [y0, y0 + box.height]) {
          const point = projectIso(box.x + dx * box.width, y, box.z + dz * box.depth, scale);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Painter's order: far boxes first, so nearer boxes overdraw them. */
export function byDepth(a: IsoBox, b: IsoBox): number {
  return a.x + a.z - (b.x + b.z) || (a.baseY ?? 0) - (b.baseY ?? 0) || a.height - b.height;
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, "0")}`;
}

/** Multiplies each RGB channel of a #rrggbb color (factor < 1 darkens). */
export function shadeHex(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  return rgb ? toHex([rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]) : hex;
}

/** Moves a #rrggbb color towards its own luminance gray by `amount` (0..1). */
export function desaturateHex(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const gray = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const mix = (channel: number) => channel + (gray - channel) * amount;
  return toHex([mix(rgb[0]), mix(rgb[1]), mix(rgb[2])]);
}
