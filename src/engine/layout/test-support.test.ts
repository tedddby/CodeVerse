import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { computeWorldLayout, DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { collectLayoutViolations, expectedDistrictIds, findOverlaps } from "./test-support";
import type { WorldLayout } from "./types";

/** The invariant checker must itself be trustworthy, or the layout tests prove nothing. */
describe("collectLayoutViolations", () => {
  const pristine = computeWorldLayout(mockRepositoryGraph);
  const check = (layout: WorldLayout) =>
    collectLayoutViolations(mockRepositoryGraph, layout, DEFAULT_LAYOUT_OPTIONS);

  it("accepts a valid layout", () => {
    expect(check(pristine)).toEqual([]);
  });

  it("reports a building that escapes its district", () => {
    const layout = structuredClone(pristine);
    const building = layout.buildings[0];
    if (!building) throw new Error("no buildings");
    building.x += 10_000;
    expect(check(layout).join("\n")).toMatch(/escapes district/);
  });

  it("reports overlapping buildings and missing gaps", () => {
    const layout = structuredClone(pristine);
    const [a, b] = layout.buildings.filter((item) => item.districtId === "dir:src/auth");
    if (!a || !b) throw new Error("fixture changed");
    b.x = a.x + a.width / 2 + b.width / 2 + DEFAULT_LAYOUT_OPTIONS.buildingGap / 4;
    b.z = a.z;
    expect(check(layout).join("\n")).toMatch(/overlap/);
  });

  it("reports missing buildings and districts, wrong terraces and off-centre worlds", () => {
    const layout = structuredClone(pristine);
    layout.buildings.pop();
    layout.districts = layout.districts.filter((district) => district.id !== "dir:docs");
    const nested = layout.districts.find((district) => district.level === 2);
    if (!nested) throw new Error("fixture changed");
    nested.baseY += 1;
    layout.bounds.minX -= 5;
    const report = check(layout).join("\n");
    expect(report).toMatch(/missing building/);
    expect(report).toMatch(/missing district dir:docs/);
    expect(report).toMatch(/not terraced/);
    expect(report).toMatch(/bounds/);
  });

  it("reports overlapping sibling districts", () => {
    const layout = structuredClone(pristine);
    const auth = layout.districts.find((district) => district.id === "dir:src/auth");
    const users = layout.districts.find((district) => district.id === "dir:src/users");
    if (!auth || !users) throw new Error("fixture changed");
    users.x = auth.x;
    users.z = auth.z;
    expect(check(layout).join("\n")).toMatch(/sibling districts/);
  });
});

describe("findOverlaps", () => {
  it("finds exactly the intersecting pairs", () => {
    const boxes = [
      { id: "a", x: 0, z: 0, width: 2, depth: 2 },
      { id: "b", x: 1.5, z: 0, width: 2, depth: 2 },
      { id: "c", x: 10, z: 0, width: 2, depth: 2 },
      { id: "d", x: 2, z: 5, width: 2, depth: 2 },
    ];
    expect(findOverlaps(boxes)).toEqual([["a", "b"]]);
    // Touching edges do not count as overlap; growing the boxes makes them overlap.
    const touching = [
      { id: "a", x: 0, z: 0, width: 2, depth: 2 },
      { id: "e", x: 2, z: 0, width: 2, depth: 2 },
    ];
    expect(findOverlaps(touching)).toEqual([]);
    expect(findOverlaps(touching, 0.1)).toEqual([["a", "e"]]);
  });
});

describe("expectedDistrictIds", () => {
  it("contains the root and every directory holding files", () => {
    const ids = expectedDistrictIds(mockRepositoryGraph);
    expect(ids.size).toBe(mockRepositoryGraph.directories.length);
  });
});
