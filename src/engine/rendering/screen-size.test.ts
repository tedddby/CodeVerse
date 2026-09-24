import { Group, PerspectiveCamera, Vector3 } from "three";
import { applyScreenScale, worldUnitsPerPixel } from "./screen-size";

const VIEWPORT_HEIGHT = 900;

/** A camera at the origin looking down -Z (three.js default), 45° vertical fov. */
function camera(): PerspectiveCamera {
  const created = new PerspectiveCamera(45, 1440 / VIEWPORT_HEIGHT, 0.1, 5_000);
  created.updateMatrixWorld();
  return created;
}

/** Screen pixels between two world points stacked along camera up at `anchor`. */
function projectedHeight(cam: PerspectiveCamera, anchor: Vector3, worldHeight: number): number {
  const a = anchor.clone().project(cam);
  const b = anchor
    .clone()
    .add(new Vector3(0, worldHeight, 0))
    .project(cam);
  return (Math.abs(b.y - a.y) / 2) * VIEWPORT_HEIGHT;
}

describe("worldUnitsPerPixel", () => {
  it("depends on view depth only, so off-axis labels are not drawn larger", () => {
    const cam = camera();
    const depth = 100;
    const offAxis = depth * Math.tan((40 * Math.PI) / 180);
    const onAxisUnits = worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 0, 0, -depth);
    expect(worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, offAxis, 0, -depth)).toBeCloseTo(
      onAxisUnits,
      9,
    );
    expect(worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 0, offAxis * 0.5, -depth)).toBeCloseTo(
      onAxisUnits,
      9,
    );
  });

  it("maps the full view height to the viewport at the point's depth", () => {
    const cam = camera();
    const perPixel = worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 0, 0, -80);
    const viewHeight = 2 * Math.tan((45 * Math.PI) / 360) * 80;
    expect(perPixel * VIEWPORT_HEIGHT).toBeCloseTo(viewHeight, 9);
  });

  it("follows the camera orientation", () => {
    const cam = camera();
    cam.position.set(10, 50, 10);
    cam.lookAt(10, 0, 10);
    cam.updateMatrixWorld();
    // Straight below at 50 units vs. 50 units deep but far to the side.
    const below = worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 10, 0, 10);
    const aside = worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 60, 0, 10);
    expect(aside).toBeCloseTo(below, 9);
  });

  it("stays positive behind the camera", () => {
    const cam = camera();
    expect(worldUnitsPerPixel(cam, VIEWPORT_HEIGHT, 0, 0, 50)).toBeGreaterThan(0);
  });
});

describe("applyScreenScale", () => {
  it("draws a label at its nominal pixel size anywhere in the view", () => {
    const cam = camera();
    for (const degrees of [0, 20, 40]) {
      const anchor = new Vector3(100 * Math.tan((degrees * Math.PI) / 180), 0, -100);
      const group = new Group();
      applyScreenScale(group, cam, VIEWPORT_HEIGHT, anchor, 12.5);
      expect(projectedHeight(cam, anchor, group.scale.y)).toBeCloseTo(12.5, 6);
    }
  });
});
