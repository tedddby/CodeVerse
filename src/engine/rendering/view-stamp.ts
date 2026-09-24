import { Matrix4, Quaternion, Vector3, type Camera } from "three";

/**
 * Remembers the last camera pose, projection and viewport size it was shown,
 * so per-frame code can skip work while the view is unchanged (an idle city
 * needs no new LOD pass or hover raycast). Allocates only on construction.
 */
export class ViewStamp {
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly projection = new Matrix4();
  private width = 0;
  private height = 0;
  private valid = false;

  /** Records the current view; true when it differs from the recorded one (always true at first). */
  update(camera: Camera, size: { width: number; height: number }): boolean {
    if (
      this.valid &&
      this.width === size.width &&
      this.height === size.height &&
      this.position.equals(camera.position) &&
      this.quaternion.equals(camera.quaternion) &&
      this.projection.equals(camera.projectionMatrix)
    ) {
      return false;
    }
    this.position.copy(camera.position);
    this.quaternion.copy(camera.quaternion);
    this.projection.copy(camera.projectionMatrix);
    this.width = size.width;
    this.height = size.height;
    this.valid = true;
    return true;
  }

  /** Forgets the recorded view: the next `update` reports a change. */
  invalidate(): void {
    this.valid = false;
  }
}
