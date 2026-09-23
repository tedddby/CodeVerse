import type { DistrictLayout } from "@/engine/layout/types";
import type { Rgb } from "./palette";

/**
 * Crisp district edges: the top rectangle of every slab as 4 line segments in
 * one merged LineSegments buffer (8 vertices per district, in layout order),
 * so hover/selection recolor a district by rewriting 8 colors.
 */

export const OUTLINE_VERTICES_PER_DISTRICT = 8;

/** Positions of every district's top rectangle, lifted by `lift` to avoid z-fighting with the slab. */
export function buildOutlinePositions(
  districts: readonly DistrictLayout[],
  lift: number,
): Float32Array {
  const positions = new Float32Array(districts.length * OUTLINE_VERTICES_PER_DISTRICT * 3);
  districts.forEach((district, i) => {
    const y = district.baseY + district.height + lift;
    const x0 = district.x - district.width / 2;
    const x1 = district.x + district.width / 2;
    const z0 = district.z - district.depth / 2;
    const z1 = district.z + district.depth / 2;
    const corners: Array<[number, number]> = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    let offset = i * OUTLINE_VERTICES_PER_DISTRICT * 3;
    for (let c = 0; c < 4; c += 1) {
      const a = corners[c];
      const b = corners[(c + 1) % 4];
      if (!a || !b) continue;
      positions.set([a[0], y, a[1], b[0], y, b[1]], offset);
      offset += 6;
    }
  });
  return positions;
}

/** Writes one district's outline color (all 8 vertices). */
export function writeOutlineColor(colors: Float32Array, districtIndex: number, color: Rgb): void {
  const start = districtIndex * OUTLINE_VERTICES_PER_DISTRICT * 3;
  if (start < 0 || start + OUTLINE_VERTICES_PER_DISTRICT * 3 > colors.length) return;
  for (let v = 0; v < OUTLINE_VERTICES_PER_DISTRICT; v += 1) {
    colors[start + v * 3] = color[0];
    colors[start + v * 3 + 1] = color[1];
    colors[start + v * 3 + 2] = color[2];
  }
}
