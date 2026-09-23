import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/fixtures/fixture-builder";
import type { Rect } from "./geometry";
import { squarify } from "./squarify";

const EPSILON = 1e-7;

function area(rect: Rect): number {
  return rect.width * rect.depth;
}

function assertTiling(rects: Rect[], container: Rect) {
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(container.x - EPSILON);
    expect(rect.z).toBeGreaterThanOrEqual(container.z - EPSILON);
    expect(rect.x + rect.width).toBeLessThanOrEqual(container.x + container.width + EPSILON);
    expect(rect.z + rect.depth).toBeLessThanOrEqual(container.z + container.depth + EPSILON);
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (!a || !b) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapZ = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
      expect(overlapX <= EPSILON || overlapZ <= EPSILON).toBe(true);
    }
  }
  const total = rects.reduce((sum, rect) => sum + area(rect), 0);
  expect(total).toBeCloseTo(area(container), 6);
}

describe("squarify", () => {
  it("tiles the rectangle exactly with areas proportional to weights", () => {
    const container = { x: -5, z: 3, width: 12, depth: 7 };
    const weights = [6, 6, 4, 3, 2, 2, 1];
    const rects = squarify(weights, container);
    assertTiling(rects, container);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    weights.forEach((weight, index) => {
      expect(area(rects[index] as Rect)).toBeCloseTo((weight / total) * area(container), 6);
    });
  });

  it("reproduces the example from Bruls et al. with good aspect ratios", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, z: 0, width: 6, depth: 4 });
    const worst = Math.max(
      ...rects.map((rect) => Math.max(rect.width / rect.depth, rect.depth / rect.width)),
    );
    // Every rectangle stays within a 3:1 aspect ratio.
    expect(worst).toBeLessThanOrEqual(3 + EPSILON);
    // First row: the two largest items stacked in a 3-wide column.
    expect(rects[0]).toMatchObject({ x: 0, z: 0, width: 3, depth: 2 });
    expect(rects[1]).toMatchObject({ x: 0, z: 2, width: 3, depth: 2 });
  });

  it("keeps aspect ratios bounded for many random decreasing weights", () => {
    const random = mulberry32(99);
    const weights = Array.from({ length: 300 }, () => 1 + random() * 50).sort((a, b) => b - a);
    const container = { x: 0, z: 0, width: 100, depth: 60 };
    const rects = squarify(weights, container);
    assertTiling(rects, container);
    const ratios = rects.map((rect) => Math.max(rect.width / rect.depth, rect.depth / rect.width));
    const median = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)] ?? 0;
    expect(median).toBeLessThan(2);
    expect(Math.max(...ratios)).toBeLessThan(8);
  });

  it("returns the whole rectangle for a single weight", () => {
    const container = { x: 1, z: 2, width: 3, depth: 4 };
    expect(squarify([42], container)).toEqual([container]);
  });

  it("gives empty rectangles when there is nothing to split", () => {
    expect(squarify([0, 0], { x: 0, z: 0, width: 5, depth: 5 })).toEqual([
      { x: 0, z: 0, width: 0, depth: 0 },
      { x: 0, z: 0, width: 0, depth: 0 },
    ]);
    expect(squarify([], { x: 0, z: 0, width: 5, depth: 5 })).toEqual([]);
  });

  it("gives zero-weight items no area while still tiling the rest", () => {
    const container = { x: 0, z: 0, width: 10, depth: 10 };
    const rects = squarify([5, 3, 0], container);
    expect(area(rects[2] as Rect)).toBeCloseTo(0, 9);
    expect(area(rects[0] as Rect) + area(rects[1] as Rect)).toBeCloseTo(100, 6);
  });
});
