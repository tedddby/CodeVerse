import { buildPosterScene, type PosterScene } from "@/components/landing/demo/poster-scene";
import { isoBounds, isoFaces, type IsoBox, type IsoFaces } from "@/components/landing/iso";
import type { RepositoryGraph } from "@/graph/model/types";

/**
 * Isometric line art of a repository's real world layout (the same
 * deterministic layout the 3D engine uses), projected to SVG polygons.
 */

export interface CityFace extends IsoFaces {
  id: string;
  kind: "district" | "building";
  color?: string;
}

export interface CityGeometry {
  /** SVG view box in projected units. */
  viewBox: string;
  width: number;
  height: number;
  /** District slabs, then buildings, in painter's order (far to near). */
  faces: CityFace[];
}

export interface CityGeometryOptions {
  /** Projected width in SVG units (strokes are non-scaling, so this only sets precision). */
  targetWidth?: number;
  padding?: number;
  /** Include the root slab (level 0) under everything. */
  includeRoot?: boolean;
}

export function projectScene(scene: PosterScene, options: CityGeometryOptions = {}): CityGeometry {
  const { targetWidth = 960, padding = 8, includeRoot = true } = options;
  const districts = includeRoot ? scene.districts : scene.districts.filter((d) => d.level > 0);
  const everything: IsoBox[] = [...districts, ...scene.buildings];
  const unit = isoBounds(everything, 1);
  const scale = targetWidth / Math.max(1, unit.maxX - unit.minX);
  const bounds = isoBounds(everything, scale);
  const minX = Math.floor(bounds.minX - padding);
  const minY = Math.floor(bounds.minY - padding);
  const width = Math.ceil(bounds.maxX - bounds.minX + padding * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + padding * 2);
  const faces: CityFace[] = [
    ...districts.map((district) => ({
      id: district.id,
      kind: "district" as const,
      ...isoFaces(district, scale),
    })),
    ...scene.buildings.map((building) => ({
      id: building.id,
      kind: "building" as const,
      color: building.color,
      ...isoFaces(building, scale),
    })),
  ];
  return { viewBox: `${minX} ${minY} ${width} ${height}`, width, height, faces };
}

const cache = new WeakMap<RepositoryGraph, CityGeometry>();

/** Line-art geometry of a graph's world, computed once per graph. */
export function cityGeometry(graph: RepositoryGraph): CityGeometry {
  const cached = cache.get(graph);
  if (cached) return cached;
  const geometry = projectScene(buildPosterScene(graph));
  cache.set(graph, geometry);
  return geometry;
}
