import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/fixtures/fixture-builder";
import { minimalSquareSide, shelfPack, shelfPackHeight, type ShelfPacking } from "./shelf-pack";

const EPSILON = 1e-9;

function cellBoxes(sides: number[], packing: ShelfPacking) {
  return sides.map((side, index) => {
    const row = packing.cellRow[index] ?? 0;
    const x = packing.cellX[index] ?? 0;
    const y = (packing.rowTop[row] ?? 0) + (packing.cellY[index] ?? 0);
    return { x0: x, x1: x + side, y0: y, y1: y + side };
  });
}

function assertValidPacking(sides: number[], maxWidth: number) {
  const packing = shelfPack(sides, maxWidth);
  expect(packing).not.toBeNull();
  if (!packing) return;
  expect(packing.width).toBeLessThanOrEqual(maxWidth + EPSILON);
  expect(packing.height).toBeCloseTo(shelfPackHeight(sides, maxWidth), 9);
  const boxes = cellBoxes(sides, packing);
  for (const box of boxes) {
    expect(box.x0).toBeGreaterThanOrEqual(-EPSILON);
    expect(box.x1).toBeLessThanOrEqual(packing.width + EPSILON);
    expect(box.y0).toBeGreaterThanOrEqual(-EPSILON);
    expect(box.y1).toBeLessThanOrEqual(packing.height + EPSILON);
  }
  const sorted = boxes.map((box, index) => ({ box, index })).sort((a, b) => a.box.x0 - b.box.x0);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]?.box;
      const b = sorted[j]?.box;
      if (!a || !b) continue;
      if (b.x0 >= a.x1 - EPSILON) break;
      const disjoint = a.y1 <= b.y0 + EPSILON || b.y1 <= a.y0 + EPSILON;
      expect(disjoint).toBe(true);
    }
  }
  return packing;
}

describe("shelfPack", () => {
  it("packs random cells without overlap and within the width", () => {
    const random = mulberry32(3);
    for (let trial = 0; trial < 20; trial += 1) {
      const sides = Array.from({ length: 1 + Math.floor(random() * 120) }, () => 1 + random() * 6);
      const widest = Math.max(...sides);
      assertValidPacking(sides, widest + random() * 40);
    }
  });

  it("keeps the given order: consecutive cells are adjacent", () => {
    const packing = shelfPack([2, 2, 2, 2], 4.5);
    expect(Array.from(packing?.cellRow ?? [])).toEqual([0, 0, 1, 1]);
    expect(Array.from(packing?.cellX ?? [])).toEqual([0, 2, 0, 2]);
  });

  it("stacks small cells under a tall one instead of opening new rows", () => {
    const packing = assertValidPacking([4, 1, 1, 1, 1], 6);
    expect(packing?.height).toBe(4);
    expect(packing?.rowTop).toHaveLength(1);
    // The four unit cells form one column next to the tall cell.
    expect(Array.from(packing?.cellY ?? [])).toEqual([0, 0, 1, 2, 3]);
  });

  it("reports infeasible widths", () => {
    expect(shelfPack([1, 5], 4)).toBeNull();
    expect(shelfPackHeight([1, 5], 4)).toBe(Number.POSITIVE_INFINITY);
    expect(shelfPackHeight([], 4)).toBe(0);
  });
});

describe("minimalSquareSide", () => {
  it("finds a square the cells actually fit in, close to the area lower bound", () => {
    const random = mulberry32(17);
    for (let trial = 0; trial < 15; trial += 1) {
      const sides = Array.from({ length: 5 + Math.floor(random() * 200) }, () => 1 + random() * 5);
      const side = minimalSquareSide(sides);
      const lowerBound = Math.sqrt(sides.reduce((sum, value) => sum + value * value, 0));
      expect(shelfPackHeight(sides, side)).toBeLessThanOrEqual(side + 1e-9);
      expect(side).toBeGreaterThanOrEqual(lowerBound - 1e-9);
      expect(side).toBeLessThan(lowerBound * 1.5);
    }
  });

  it("is exact for trivial inputs", () => {
    expect(minimalSquareSide([])).toBe(0);
    expect(minimalSquareSide([3])).toBe(3);
    expect(minimalSquareSide([2, 2, 2, 2])).toBeCloseTo(4, 2);
  });
});
