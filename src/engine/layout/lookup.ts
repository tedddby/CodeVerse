import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, SymbolNode } from "@/graph/model/types";
import { layoutSymbolBands } from "./symbol-bands";
import type { BuildingLayout, DistrictLayout, WorldLayout } from "./types";

/**
 * O(1) access to layout elements by node id, plus camera framing helpers used
 * by the camera rig ("fly to"), the minimap and share links.
 */
export interface LayoutLookup {
  buildingsById: Map<string, BuildingLayout>;
  districtsById: Map<string, DistrictLayout>;
  /** Index of each building in `layout.buildings` (instance id for instanced meshes). */
  buildingIndexById: Map<string, number>;
  /** Index of each district in `layout.districts`. */
  districtIndexById: Map<string, number>;
}

/** Bounding sphere used to frame something with the camera. */
export interface FrameSphere {
  center: [number, number, number];
  radius: number;
}

/** Smallest radius returned, so the camera never ends up inside a tiny target. */
export const MIN_FRAME_RADIUS = 1.5;

export function buildLayoutLookup(layout: WorldLayout): LayoutLookup {
  const buildingsById = new Map<string, BuildingLayout>();
  const buildingIndexById = new Map<string, number>();
  layout.buildings.forEach((building, index) => {
    buildingsById.set(building.id, building);
    buildingIndexById.set(building.id, index);
  });
  const districtsById = new Map<string, DistrictLayout>();
  const districtIndexById = new Map<string, number>();
  layout.districts.forEach((district, index) => {
    districtsById.set(district.id, district);
    districtIndexById.set(district.id, index);
  });
  return { buildingsById, districtsById, buildingIndexById, districtIndexById };
}

/** Sphere enclosing an axis-aligned box given by its footprint centre/extents and vertical range. */
function boxSphere(
  x: number,
  z: number,
  width: number,
  depth: number,
  bottom: number,
  top: number,
): FrameSphere {
  const halfHeight = Math.max(0, top - bottom) / 2;
  const radius = Math.sqrt((width / 2) ** 2 + (depth / 2) ** 2 + halfHeight ** 2);
  return { center: [x, bottom + halfHeight, z], radius: Math.max(MIN_FRAME_RADIUS, radius) };
}

function frameBuilding(building: BuildingLayout): FrameSphere {
  return boxSphere(
    building.x,
    building.z,
    building.width,
    building.depth,
    building.baseY,
    building.baseY + building.height,
  );
}

function frameDistrict(
  district: DistrictLayout,
  lookup: LayoutLookup,
  index: GraphIndex,
): FrameSphere {
  let top = district.baseY + district.height;
  for (const fileId of index.filesUnder(district.id)) {
    const building = lookup.buildingsById.get(fileId);
    if (building && building.baseY + building.height > top) top = building.baseY + building.height;
  }
  return boxSphere(district.x, district.z, district.width, district.depth, district.baseY, top);
}

function frameSymbol(
  symbol: SymbolNode,
  lookup: LayoutLookup,
  index: GraphIndex,
): FrameSphere | null {
  const file = index.filesById.get(symbol.fileId);
  const building = file ? lookup.buildingsById.get(file.id) : undefined;
  if (!file || !building) return null;
  const symbols: SymbolNode[] = [];
  for (const id of file.symbolIds) {
    const candidate = index.symbolsById.get(id);
    if (candidate) symbols.push(candidate);
  }
  if (!symbols.includes(symbol)) symbols.push(symbol);
  const band = layoutSymbolBands(file, symbols, building).find((item) => item.id === symbol.id);
  if (!band) return frameBuilding(building);
  return boxSphere(building.x, building.z, building.width, building.depth, band.y0, band.y1);
}

/**
 * Bounding sphere to frame a directory (its district and everything standing
 * on it), a file (its building) or a symbol (its band on the building).
 * Returns null when the node is unknown or has no geometry in this layout
 * (e.g. an empty directory, which gets no district).
 */
export function frameTarget(
  layout: WorldLayout,
  lookup: LayoutLookup,
  ref: NodeRef,
  index: GraphIndex,
): FrameSphere | null {
  switch (ref.kind) {
    case "directory": {
      const district = lookup.districtsById.get(ref.id);
      if (!district) return null;
      // The root district holds everything: the world frame is exact and O(1).
      return district.level === 0 ? worldFrame(layout) : frameDistrict(district, lookup, index);
    }
    case "file": {
      const building = lookup.buildingsById.get(ref.id);
      return building ? frameBuilding(building) : null;
    }
    case "symbol": {
      const symbol = index.symbolsById.get(ref.id);
      return symbol ? frameSymbol(symbol, lookup, index) : null;
    }
  }
}

/** Sphere enclosing the whole world (ground bounds and tallest building). */
export function worldFrame(layout: WorldLayout): FrameSphere {
  const { minX, maxX, minZ, maxZ, maxY } = layout.bounds;
  return boxSphere((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, 0, maxY);
}
