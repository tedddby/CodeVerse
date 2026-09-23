import {
  BoxGeometry,
  InstancedMesh,
  Sphere,
  Vector3,
  type InstancedBufferAttribute,
  type Material,
} from "three";

/**
 * Helpers for the instanced-box layers (buildings, district slabs, symbol
 * bands). Every box is a unit cube translated so its base sits at y = 0, then
 * placed with an axis-aligned instance matrix (scale + translation only).
 */

/** Unit cube with its base at y = 0 (so scaling by height grows it upward). */
export function createUnitBoxGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

const MIN_SCALE = 1e-4;

/** Writes a column-major scale+translation matrix for instance `index`. */
export function writeBoxMatrix(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): void {
  const o = index * 16;
  target.fill(0, o, o + 16);
  target[o] = Math.max(MIN_SCALE, width);
  target[o + 5] = Math.max(MIN_SCALE, height);
  target[o + 10] = Math.max(MIN_SCALE, depth);
  target[o + 12] = x;
  target[o + 13] = y;
  target[o + 14] = z;
  target[o + 15] = 1;
}

/**
 * Creates an instanced box mesh with its own geometry (so per-instance
 * attributes live on the geometry) and the given bounding sphere for culling
 * and raycast early-outs. The caller owns and disposes the geometry.
 */
export function createInstancedBoxes(
  count: number,
  material: Material,
  attributes: Record<string, InstancedBufferAttribute>,
  bounds?: { center: readonly [number, number, number]; radius: number },
): InstancedMesh {
  const geometry = createUnitBoxGeometry();
  for (const [name, attribute] of Object.entries(attributes))
    geometry.setAttribute(name, attribute);
  const mesh = new InstancedMesh(geometry, material, Math.max(0, count));
  if (bounds) {
    mesh.boundingSphere = new Sphere(new Vector3(...bounds.center), Math.max(bounds.radius, 1e-3));
  }
  return mesh;
}

/** Recomputes the mesh bounds after instance matrices changed. */
export function refreshInstanceBounds(mesh: InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}
