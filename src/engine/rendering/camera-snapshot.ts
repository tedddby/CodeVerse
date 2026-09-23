import type { RootState } from "@react-three/fiber";
import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from "three";
import type { Vec3Like } from "@/engine/lod/projection";

/**
 * A plain-data snapshot of the camera for LOD decisions: position, field of
 * view, a frustum test on bounding spheres and a world -> screen projection.
 * Scratch objects are reused, so a snapshot at a few Hz allocates almost nothing.
 */
export interface CameraSnapshot {
  position: Vec3Like;
  /** Effective vertical fov in degrees. */
  fovY: number;
  viewportHeight: number;
  /** True when a sphere intersects the view frustum. */
  sphereVisible: (x: number, y: number, z: number, radius: number) => boolean;
  /** World point -> screen pixels (y down), or null when outside the depth range / behind the camera. */
  project: (x: number, y: number, z: number) => { x: number; y: number } | null;
}

const frustum = new Frustum();
const projection = new Matrix4();
const sphere = new Sphere();
const point = new Vector3();

export function snapshotCamera(state: RootState): CameraSnapshot {
  const { camera, size } = state;
  camera.updateMatrixWorld();
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projection);
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    fovY: camera instanceof PerspectiveCamera ? camera.getEffectiveFOV() : 45,
    viewportHeight: Math.max(1, size.height),
    sphereVisible: (x, y, z, radius) => {
      sphere.center.set(x, y, z);
      sphere.radius = radius;
      return frustum.intersectsSphere(sphere);
    },
    project: (x, y, z) => {
      point.set(x, y, z).applyMatrix4(projection);
      // applyMatrix4 performs the perspective divide; |z| > 1 is outside the clip range.
      if (!Number.isFinite(point.z) || point.z < -1 || point.z > 1) return null;
      return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
    },
  };
}
