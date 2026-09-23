import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { createFileBlock, evaluateBlockFit, placeBlockBuildings } from "./file-block";
import type { Rect } from "./geometry";
import type { LayoutFileInput } from "./layout-input";
import { boxOf, contains, findOverlaps } from "./test-support";

const options = DEFAULT_LAYOUT_OPTIONS;

function files(count: number): LayoutFileInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file:f${index}.ts`,
    path: `f${index}.ts`,
    size: 500 + ((index * 7919) % 40_000),
    lines: 10 + ((index * 131) % 900),
    directoryId: "dir:",
    status: "parsed" as const,
  }));
}

const asBox = (rect: Rect) => ({
  minX: rect.x,
  maxX: rect.x + rect.width,
  minZ: rect.z,
  maxZ: rect.z + rect.depth,
});

describe("file blocks", () => {
  it("asks for at least the area of its cells, plus lots for omitted files", () => {
    const block = createFileBlock("dir:", files(30), 0, options);
    const cellArea = Array.from(block.cells).reduce((sum, cell) => sum + cell * cell, 0);
    expect(block.baseArea).toBeGreaterThanOrEqual(cellArea);
    const withOmitted = createFileBlock("dir:", files(30), 100, options);
    expect(withOmitted.baseArea).toBeGreaterThan(block.baseArea);
    const omittedOnly = createFileBlock("dir:", [], 10, options);
    expect(omittedOnly.baseArea).toBeGreaterThan(0);
    expect(evaluateBlockFit(omittedOnly, { x: 0, z: 0, width: 1, depth: 1 }).fits).toBe(true);
  });

  it("fits its own square and places buildings inside the rectangle with gaps", () => {
    const block = createFileBlock("dir:", files(60), 0, options);
    const side = Math.sqrt(block.baseArea);
    const rect = { x: -3, z: 7, width: side, depth: side };
    const fit = evaluateBlockFit(block, rect);
    expect(fit.fits).toBe(true);
    const buildings = placeBlockBuildings(block, rect, fit, 2, options);
    expect(buildings).toHaveLength(60);
    for (const building of buildings) {
      expect(contains(asBox(rect), boxOf(building), options.buildingGap / 2)).toBe(true);
      expect(building.baseY).toBe(2);
    }
    expect(findOverlaps(buildings, options.buildingGap / 2 - 0.002)).toEqual([]);
  });

  it("uses the other orientation when rows along the long side do not fit", () => {
    const block = createFileBlock("dir:", files(12), 0, options);
    const tall = { x: 0, z: 0, width: block.largestCell * 1.2, depth: 400 };
    const fit = evaluateBlockFit(block, tall);
    expect(fit.fits).toBe(true);
    const buildings = placeBlockBuildings(block, tall, fit, 0, options);
    for (const building of buildings) expect(contains(asBox(tall), boxOf(building))).toBe(true);
  });

  it("reports overflow for a slot that is too small, relative to the slot", () => {
    const block = createFileBlock("dir:", files(40), 0, options);
    const side = Math.sqrt(block.baseArea);
    const small = { x: 0, z: 0, width: side / 2, depth: side / 2 };
    const fit = evaluateBlockFit(block, small, 0.8);
    expect(fit.fits).toBe(false);
    expect(fit.overflow).toBeGreaterThan(1);
    const thin = { x: 0, z: 0, width: block.largestCell / 2, depth: block.largestCell / 2 };
    expect(evaluateBlockFit(block, thin).overflow).toBeGreaterThanOrEqual(2);
  });

  it("scales buildings down as a last resort, preserving containment and non-overlap", () => {
    const block = createFileBlock("dir:", files(80), 0, options);
    const side = Math.sqrt(block.baseArea);
    const small = { x: 5, z: -5, width: side / 3, depth: side / 4 };
    const fit = evaluateBlockFit(block, small);
    expect(fit.fits).toBe(false);
    const buildings = placeBlockBuildings(block, small, fit, 0, options);
    expect(buildings).toHaveLength(80);
    for (const building of buildings) expect(contains(asBox(small), boxOf(building))).toBe(true);
    expect(findOverlaps(buildings)).toEqual([]);
    const largest = Math.max(...buildings.map((building) => building.width));
    expect(largest).toBeLessThan(options.maxFootprint);
  });
});
