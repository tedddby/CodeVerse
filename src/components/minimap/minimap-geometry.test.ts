import { describe, expect, it } from "vitest";
import type { WorldBounds } from "@/engine/layout/types";
import {
  boundsCenter,
  cameraFootprint,
  createMinimapTransform,
  minimapToWorld,
  panPoint,
  rectToMinimap,
  worldToMinimap,
} from "./minimap-geometry";

const square: WorldBounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50, maxY: 20, size: 100 };
const wide: WorldBounds = { minX: -100, maxX: 100, minZ: -25, maxZ: 25, maxY: 20, size: 200 };

describe("createMinimapTransform", () => {
  it("fits a square world into the padded map", () => {
    const transform = createMinimapTransform(square, 200, 10);
    expect(transform.scale).toBeCloseTo(1.8);
    expect(worldToMinimap(transform, -50, -50)).toEqual({ x: 10, y: 10 });
    expect(worldToMinimap(transform, 50, 50)).toEqual({ x: 190, y: 190 });
    expect(worldToMinimap(transform, 0, 0)).toEqual({ x: 100, y: 100 });
  });

  it("preserves aspect ratio and centres the shorter axis", () => {
    const transform = createMinimapTransform(wide, 200, 0);
    expect(transform.scale).toBe(1);
    expect(worldToMinimap(transform, -100, -25)).toEqual({ x: 0, y: 75 });
    expect(worldToMinimap(transform, 100, 25)).toEqual({ x: 200, y: 125 });
  });

  it("handles degenerate bounds without dividing by zero", () => {
    const point: WorldBounds = { minX: 3, maxX: 3, minZ: 4, maxZ: 4, maxY: 0, size: 0 };
    const transform = createMinimapTransform(point, 200, 8);
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(minimapToWorld(transform, 100, 100)).toEqual({ x: 3, z: 4 });
  });
});

describe("world <-> minimap round trip", () => {
  it("inverts exactly inside the bounds", () => {
    const transform = createMinimapTransform(wide, 200, 8);
    for (const [x, z] of [
      [-100, -25],
      [0, 0],
      [37.5, -12.25],
      [100, 25],
    ] as const) {
      const pixel = worldToMinimap(transform, x, z);
      const world = minimapToWorld(transform, pixel.x, pixel.y);
      expect(world.x).toBeCloseTo(x, 9);
      expect(world.z).toBeCloseTo(z, 9);
    }
  });

  it("clamps clicks in the padding to the world bounds", () => {
    const transform = createMinimapTransform(square, 200, 10);
    expect(minimapToWorld(transform, 0, 0)).toEqual({ x: -50, z: -50 });
    expect(minimapToWorld(transform, 200, 200)).toEqual({ x: 50, z: 50 });
  });
});

describe("rectToMinimap", () => {
  it("converts centre/extent rectangles to top-left pixel rectangles", () => {
    const transform = createMinimapTransform(square, 200, 10);
    expect(rectToMinimap(transform, 0, 0, 20, 10)).toEqual({ x: 82, y: 91, width: 36, height: 18 });
  });

  it("enlarges tiny rectangles around their centre", () => {
    const transform = createMinimapTransform(square, 200, 10);
    const rect = rectToMinimap(transform, 0, 0, 0.1, 0.1, 2);
    expect(rect.width).toBe(2);
    expect(rect.height).toBe(2);
    expect(rect.x + rect.width / 2).toBeCloseTo(100, 9);
    expect(rect.y + rect.height / 2).toBeCloseTo(100, 9);
  });
});

describe("cameraFootprint", () => {
  const transform = createMinimapTransform(square, 200, 0);

  it("points the view wedge from the camera towards its target", () => {
    const footprint = cameraFootprint(transform, { position: [0, 40, 40], target: [0, 0, 0] }, 0.5);
    expect(footprint.position).toEqual({ x: 100, y: 180 });
    expect(footprint.target).toEqual({ x: 100, y: 100 });
    expect(footprint.wedge).not.toBeNull();
    const { left, right } = footprint.wedge ?? { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    // Looking north (up on the map): both corners are above the camera, mirrored left/right.
    expect(left.y).toBeLessThan(180);
    expect(right.y).toBeLessThan(180);
    expect(left.x).toBeCloseTo(200 - right.x, 9);
    expect(left.x).toBeLessThan(100);
  });

  it("clamps the wedge length to a readable range", () => {
    const near = cameraFootprint(transform, { position: [0, 10, 2], target: [0, 0, 0] });
    const far = cameraFootprint(transform, { position: [-50, 10, 50], target: [50, 0, -50] });
    const length = (f: typeof near) =>
      Math.hypot((f.wedge?.left.x ?? 0) - f.position.x, (f.wedge?.left.y ?? 0) - f.position.y);
    expect(length(near)).toBeCloseTo(14, 6);
    expect(length(far)).toBeCloseTo(200 * 0.45, 6);
  });

  it("has no wedge when looking straight down", () => {
    const footprint = cameraFootprint(transform, { position: [10, 80, 10], target: [10, 0, 10] });
    expect(footprint.wedge).toBeNull();
  });
});

describe("panPoint", () => {
  it("moves by a fraction of the world size and clamps", () => {
    expect(panPoint(square, { x: 0, z: 0 }, "north", 0.1)).toEqual({ x: 0, z: -10 });
    expect(panPoint(square, { x: 0, z: 0 }, "east", 0.1)).toEqual({ x: 10, z: 0 });
    expect(panPoint(square, { x: 45, z: 48 }, "south", 0.1)).toEqual({ x: 45, z: 50 });
    expect(panPoint(square, { x: -45, z: 0 }, "west", 0.2)).toEqual({ x: -50, z: 0 });
    expect(boundsCenter(wide)).toEqual({ x: 0, z: 0 });
  });
});
