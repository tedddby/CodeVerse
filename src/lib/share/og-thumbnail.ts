import type { WorldLayout } from "@/engine/layout/types";

/**
 * Geometry for the visualization thumbnail on social preview cards.
 *
 * - `projectCityMap` draws the real world layout top-down (districts and
 *   buildings) when an analysed graph is cached.
 * - `generateAbstractMap` draws a deterministic, clearly abstract city seeded
 *   from the repository name when nothing has been analysed yet.
 *
 * Output is plain rectangles in pixel space; `og-thumbnail-svg.ts` serializes
 * them into one SVG image for the card renderer.
 */

export interface ThumbnailRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThumbnailDistrict extends ThumbnailRect {
  /** Nesting level (root = 0). */
  level: number;
}

export interface ThumbnailBuilding extends ThumbnailRect {
  color: string;
  /** 0..1, brighter for taller buildings. */
  opacity: number;
}

export interface OgThumbnail {
  /** "city": real layout; "abstract": generated placeholder. */
  kind: "city" | "abstract";
  width: number;
  height: number;
  districts: ThumbnailDistrict[];
  buildings: ThumbnailBuilding[];
  /** Buildings in the source layout (may exceed `buildings.length` when capped). */
  totalBuildings: number;
}

export interface ThumbnailBox {
  width: number;
  height: number;
  /** Inner margin in pixels. */
  padding?: number;
}

export interface CityMapOptions extends ThumbnailBox {
  maxBuildings?: number;
  maxDistricts?: number;
}

export const DEFAULT_MAX_BUILDINGS = 1_500;
export const DEFAULT_MAX_DISTRICTS = 240;
const MIN_BUILDING_PX = 1.2;
const MIN_DISTRICT_PX = 2;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Projects a world layout top-down into a pixel box (X → x, Z → y), preserving aspect ratio. */
export function projectCityMap(
  layout: WorldLayout,
  colorForFile: (fileId: string) => string,
  options: CityMapOptions,
): OgThumbnail {
  const padding = options.padding ?? 12;
  const maxBuildings = options.maxBuildings ?? DEFAULT_MAX_BUILDINGS;
  const maxDistricts = options.maxDistricts ?? DEFAULT_MAX_DISTRICTS;
  const { bounds } = layout;
  // At least one world unit, so a degenerate world cannot produce an absurd scale.
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1);
  const innerWidth = Math.max(options.width - padding * 2, 1);
  const innerHeight = Math.max(options.height - padding * 2, 1);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanZ);
  const offsetX = (options.width - spanX * scale) / 2 - bounds.minX * scale;
  const offsetY = (options.height - spanZ * scale) / 2 - bounds.minZ * scale;

  const project = (x: number, z: number, width: number, depth: number, minSize: number): ThumbnailRect => {
    const w = Math.min(Math.max(width * scale, minSize), options.width);
    const h = Math.min(Math.max(depth * scale, minSize), options.height);
    const clampedX = Math.min(Math.max(offsetX + x * scale - w / 2, 0), options.width - w);
    const clampedY = Math.min(Math.max(offsetY + z * scale - h / 2, 0), options.height - h);
    return { x: round(clampedX), y: round(clampedY), width: round(w), height: round(h) };
  };

  const districts = layout.districts
    .map((district) => ({
      level: district.level,
      area: district.width * district.depth,
      rect: project(district.x, district.z, district.width, district.depth, 0),
    }))
    .filter((district) => district.rect.width >= MIN_DISTRICT_PX && district.rect.height >= MIN_DISTRICT_PX)
    .sort((a, b) => b.area - a.area || a.level - b.level)
    .slice(0, maxDistricts)
    // Parents first so nested districts draw on top.
    .sort((a, b) => a.level - b.level || b.area - a.area)
    .map(({ level, rect }) => ({ ...rect, level }));

  let maxHeight = 0;
  for (const building of layout.buildings) if (building.height > maxHeight) maxHeight = building.height;

  const buildings = [...layout.buildings]
    .sort((a, b) => b.width * b.depth * b.height - a.width * a.depth * a.height || a.id.localeCompare(b.id))
    .slice(0, maxBuildings)
    .map((building) => ({
      ...project(building.x, building.z, building.width, building.depth, MIN_BUILDING_PX),
      color: colorForFile(building.id),
      opacity: round(0.45 + 0.55 * (maxHeight > 0 ? Math.sqrt(building.height / maxHeight) : 1)),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    kind: "city",
    width: options.width,
    height: options.height,
    districts,
    buildings,
    totalBuildings: layout.buildings.length,
  };
}

// ─── Abstract placeholder ───────────────────────────────────────────────────

/** FNV-1a 32-bit hash; stable seed from a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mixes a hex color with white (t > 0) or black (t < 0); |t| in 0..1. */
export function shadeColor(color: string, t: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const target = t >= 0 ? 255 : 0;
  const amount = Math.min(1, Math.abs(t));
  const mixed = rgb.map((channel) => Math.round(channel + (target - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

/** Splits a region into weighted slices along its longer side. */
function sliceRegion(region: Region, weights: number[], gap: number): Region[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const horizontal = region.width >= region.height;
  const length = (horizontal ? region.width : region.height) - gap * (weights.length - 1);
  const slices: Region[] = [];
  let cursor = horizontal ? region.x : region.y;
  for (const weight of weights) {
    const size = (weight / total) * length;
    slices.push(
      horizontal
        ? { x: cursor, y: region.y, width: size, height: region.height, depth: region.depth + 1 }
        : { x: region.x, y: cursor, width: region.width, height: size, depth: region.depth + 1 },
    );
    cursor += size + gap;
  }
  return slices;
}

/**
 * Generates a deterministic abstract city (treemap districts filled with a
 * grid of buildings) from a seed string and an accent color.
 */
export function generateAbstractMap(seedText: string, accentColor: string, box: ThumbnailBox & { maxBuildings?: number }): OgThumbnail {
  const random = seededRandom(hashString(seedText));
  const padding = box.padding ?? 12;
  const maxBuildings = box.maxBuildings ?? 900;
  const palette = [accentColor, shadeColor(accentColor, 0.35), shadeColor(accentColor, -0.25), "#4de2ff", "#9b8cff"];

  const root: Region = {
    x: padding,
    y: padding,
    width: Math.max(box.width - padding * 2, 1),
    height: Math.max(box.height - padding * 2, 1),
    depth: 0,
  };

  const leaves: Region[] = [];
  const split = (region: Region) => {
    const canSplit = region.depth < 3 && region.width > 90 && region.height > 70;
    if (!canSplit || (region.depth >= 2 && random() < 0.35)) {
      leaves.push(region);
      return;
    }
    const count = 2 + Math.floor(random() * 3);
    const weights = Array.from({ length: count }, () => 0.5 + random());
    for (const child of sliceRegion(region, weights, 10 - region.depth * 3)) split(child);
  };
  split(root);

  const districts: ThumbnailDistrict[] = leaves.map((leaf) => ({
    x: round(leaf.x),
    y: round(leaf.y),
    width: round(leaf.width),
    height: round(leaf.height),
    level: leaf.depth,
  }));

  const buildings: ThumbnailBuilding[] = [];
  for (const leaf of leaves) {
    const cell = 10 + Math.floor(random() * 8);
    const gap = 3;
    const inset = 6;
    const columns = Math.floor((leaf.width - inset * 2 + gap) / (cell + gap));
    const rows = Math.floor((leaf.height - inset * 2 + gap) / (cell + gap));
    const districtColor = palette[Math.floor(random() * palette.length)] ?? accentColor;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (buildings.length >= maxBuildings) break;
        if (random() < 0.28) continue;
        const size = cell * (0.55 + random() * 0.45);
        buildings.push({
          x: round(leaf.x + inset + column * (cell + gap) + (cell - size) / 2),
          y: round(leaf.y + inset + row * (cell + gap) + (cell - size) / 2),
          width: round(size),
          height: round(size),
          color: random() < 0.8 ? districtColor : (palette[Math.floor(random() * palette.length)] ?? accentColor),
          opacity: round(0.3 + random() * 0.7),
        });
      }
    }
  }

  return {
    kind: "abstract",
    width: box.width,
    height: box.height,
    districts,
    buildings,
    totalBuildings: buildings.length,
  };
}
