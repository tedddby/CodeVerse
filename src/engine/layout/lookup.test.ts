import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { directoryId, fileId } from "@/graph/model/ids";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { computeWorldLayout } from "./compute-layout";
import {
  buildLayoutLookup,
  frameTarget,
  MIN_FRAME_RADIUS,
  worldFrame,
  type FrameSphere,
} from "./lookup";
import { layoutSymbolBands } from "./symbol-bands";

const layout = computeWorldLayout(mockRepositoryGraph);
const index = buildGraphIndex(mockRepositoryGraph);
const lookup = buildLayoutLookup(layout);

function encloses(sphere: FrameSphere, point: [number, number, number]): boolean {
  const [cx, cy, cz] = sphere.center;
  return Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz) <= sphere.radius + 1e-6;
}

function boxCorners(x: number, z: number, width: number, depth: number, y0: number, y1: number) {
  const corners: Array<[number, number, number]> = [];
  for (const dx of [-width / 2, width / 2]) {
    for (const dz of [-depth / 2, depth / 2]) {
      for (const y of [y0, y1]) corners.push([x + dx, y, z + dz]);
    }
  }
  return corners;
}

describe("buildLayoutLookup", () => {
  it("indexes every building and district by id and position", () => {
    expect(lookup.buildingsById.size).toBe(layout.buildings.length);
    expect(lookup.districtsById.size).toBe(layout.districts.length);
    layout.buildings.forEach((building, position) => {
      expect(lookup.buildingsById.get(building.id)).toBe(building);
      expect(lookup.buildingIndexById.get(building.id)).toBe(position);
    });
    layout.districts.forEach((district, position) => {
      expect(lookup.districtIndexById.get(district.id)).toBe(position);
    });
  });
});

describe("frameTarget", () => {
  it("frames a file's whole building", () => {
    const id = fileId("src/auth/auth.ts");
    const building = lookup.buildingsById.get(id);
    const frame = frameTarget(layout, lookup, { kind: "file", id }, index);
    if (!building || !frame) throw new Error("missing frame");
    expect(frame.center[0]).toBeCloseTo(building.x, 9);
    expect(frame.center[2]).toBeCloseTo(building.z, 9);
    expect(frame.center[1]).toBeCloseTo(building.baseY + building.height / 2, 9);
    for (const corner of boxCorners(
      building.x,
      building.z,
      building.width,
      building.depth,
      building.baseY,
      building.baseY + building.height,
    )) {
      expect(encloses(frame, corner)).toBe(true);
    }
  });

  it("frames a directory's district including the buildings standing on it", () => {
    const id = directoryId("src/payments");
    const district = lookup.districtsById.get(id);
    const frame = frameTarget(layout, lookup, { kind: "directory", id }, index);
    if (!district || !frame) throw new Error("missing frame");
    expect(frame.center[0]).toBeCloseTo(district.x, 9);
    expect(frame.center[2]).toBeCloseTo(district.z, 9);
    for (const fileIdUnder of index.filesUnder(id)) {
      const building = lookup.buildingsById.get(fileIdUnder);
      if (!building) throw new Error("missing building");
      for (const corner of boxCorners(
        building.x,
        building.z,
        building.width,
        building.depth,
        building.baseY,
        building.baseY + building.height,
      )) {
        expect(encloses(frame, corner)).toBe(true);
      }
    }
  });

  it("frames the root directory as the whole world", () => {
    const frame = frameTarget(
      layout,
      lookup,
      { kind: "directory", id: mockRepositoryGraph.rootDirectoryId },
      index,
    );
    expect(frame).toEqual(worldFrame(layout));
  });

  it("frames a symbol by its band on the building", () => {
    const file = index.filesByPath.get("src/auth/auth.ts");
    const symbol = mockRepositoryGraph.symbols.find(
      (item) => item.name === "refresh" && item.fileId === file?.id,
    );
    const building = file ? lookup.buildingsById.get(file.id) : undefined;
    if (!file || !symbol || !building) throw new Error("fixture changed");
    const frame = frameTarget(layout, lookup, { kind: "symbol", id: symbol.id }, index);
    const symbols = file.symbolIds.flatMap((id) => index.symbolsById.get(id) ?? []);
    const band = layoutSymbolBands(file, symbols, building).find((item) => item.id === symbol.id);
    if (!frame || !band) throw new Error("missing frame");
    expect(frame.center[1]).toBeCloseTo((band.y0 + band.y1) / 2, 9);
    expect(frame.center[0]).toBeCloseTo(building.x, 9);
    const fileFrame = frameTarget(layout, lookup, { kind: "file", id: file.id }, index);
    expect(frame.radius).toBeLessThan(fileFrame?.radius ?? 0);
    expect(frame.radius).toBeGreaterThanOrEqual(MIN_FRAME_RADIUS);
  });

  it("returns null for unknown nodes and directories without districts", () => {
    expect(frameTarget(layout, lookup, { kind: "file", id: "file:nope.ts" }, index)).toBeNull();
    expect(frameTarget(layout, lookup, { kind: "symbol", id: "sym:nope#x@1" }, index)).toBeNull();
    expect(frameTarget(layout, lookup, { kind: "directory", id: "dir:nope" }, index)).toBeNull();
  });
});

describe("worldFrame", () => {
  it("encloses the whole world", () => {
    const frame = worldFrame(layout);
    const { minX, maxX, minZ, maxZ, maxY } = layout.bounds;
    expect(frame.center[0]).toBeCloseTo((minX + maxX) / 2, 9);
    expect(frame.center[2]).toBeCloseTo((minZ + maxZ) / 2, 9);
    for (const x of [minX, maxX]) {
      for (const z of [minZ, maxZ]) {
        for (const y of [0, maxY]) expect(encloses(frame, [x, y, z])).toBe(true);
      }
    }
  });

  it("has a positive radius for an empty world", () => {
    const empty = { ...layout, districts: [], buildings: [] };
    empty.bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0, size: 0 };
    expect(worldFrame(empty).radius).toBe(MIN_FRAME_RADIUS);
  });
});
