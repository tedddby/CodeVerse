/**
 * Output of the deterministic 3D layout engine, consumed by the renderer,
 * minimap, camera rig and share links.
 *
 * Coordinate system (right-handed, three.js default):
 * - The ground plane is XZ at y = 0; +Y is up.
 * - One world unit is abstract; the whole world fits roughly in a square of
 *   side `bounds.size` centred on the origin.
 * - Every rectangle is described by its centre (x, z) and extents (width along X,
 *   depth along Z).
 *
 * The same `RepositoryGraph` must always produce the same `WorldLayout`
 * (no Math.random, no Date, no iteration-order dependence on Map/Set insertion
 * from unordered sources).
 */

export const LAYOUT_VERSION = 1 as const;

export interface DistrictLayout {
  /** DirectoryNode id. */
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Y of the bottom of the district slab. */
  baseY: number;
  /** Slab thickness; the walkable top is at baseY + height. */
  height: number;
  /** Nesting level (root = 0). */
  level: number;
  /** Suggested label font size in world units (scaled to district size). */
  labelSize: number;
}

export interface BuildingLayout {
  /** FileNode id. */
  id: string;
  /** Owning district (DirectoryNode id). */
  districtId: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Building height (from lines of code). */
  height: number;
  /** Y of the building's base (the top of its district slab). */
  baseY: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Tallest point in the world (building top). */
  maxY: number;
  /** max(maxX - minX, maxZ - minZ). */
  size: number;
}

export interface WorldLayout {
  version: typeof LAYOUT_VERSION;
  /** RepositoryInfo.id + commit SHA the layout was computed for. */
  key: string;
  bounds: WorldBounds;
  districts: DistrictLayout[];
  buildings: BuildingLayout[];
  /** Milliseconds spent computing the layout. */
  durationMs: number;
}

/** Symbol band on a building facade, computed lazily for close-up views. */
export interface SymbolBandLayout {
  /** SymbolNode id. */
  id: string;
  fileId: string;
  /** World-space vertical range of the band. */
  y0: number;
  y1: number;
  /** Horizontal inset (0 = flush with facade); nested symbols are inset further. */
  inset: number;
  /** Nesting depth (0 for top-level symbols). */
  depth: number;
}

export interface LayoutOptions {
  /** Gap between sibling districts (world units). */
  districtPadding: number;
  /** Gap between buildings inside a district. */
  buildingGap: number;
  /** Min/max building footprint side. */
  minFootprint: number;
  maxFootprint: number;
  /** Min/max building height. */
  minHeight: number;
  maxHeight: number;
  /** Slab thickness per nesting level. */
  slabHeight: number;
}
