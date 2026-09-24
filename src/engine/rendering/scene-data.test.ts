import { computeWorldLayout } from "@/engine/layout/compute-layout";
import { buildLayoutLookup } from "@/engine/layout/lookup";
import { DISTRICT_LABEL_BUDGET } from "@/engine/lod/district-labels";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { directoryId, fileId, ROOT_DIRECTORY_ID } from "@/graph/model/ids";
import { buildFixtureGraph, createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  computeDistrictLabelViews,
  districtSubline,
  labelViewsSignature,
  type LabelCamera,
} from "./district-label-views";
import { dustPositions, fogDensity, niceStep } from "./environment-math";
import { bracketPositions, padBox, selectionTarget } from "./selection-geometry";
import { BandCache, bandPickRef, symbolLabelText } from "./symbol-band-data";
import { tooltipContent } from "./tooltip-content";

const index = buildGraphIndex(mockRepositoryGraph);
const layout = computeWorldLayout(mockRepositoryGraph);
const lookup = buildLayoutLookup(layout);

/** A camera above the city looking down at the origin, with a simple pinhole projection. */
function cameraAbove(height: number): LabelCamera {
  const position = { x: 0, y: height, z: height * 0.6 };
  const viewportHeight = 900;
  const focal = viewportHeight / 2 / Math.tan((45 * Math.PI) / 360);
  return {
    position,
    fovY: 45,
    viewportWidth: 1600,
    viewportHeight,
    // Top-down stand-in for a perspective projection: screen x from world x, screen y from world z.
    project: (x, _y, z) => ({ x: 800 + (x * focal) / height, y: 450 + (z * focal) / height }),
    depth: () => height,
  };
}

describe("computeDistrictLabelViews", () => {
  it("labels districts that are large on screen and never the root", () => {
    const views = computeDistrictLabelViews({
      layout,
      index,
      camera: cameraAbove(60),
      focusedId: null,
      previous: new Set(),
    });
    expect(views.length).toBeGreaterThan(0);
    expect(views.some((view) => view.id === ROOT_DIRECTORY_ID)).toBe(false);
    expect(new Set(views.map((view) => view.id)).size).toBe(views.length);
  });

  it("anchors every label on its own district's slab top, uppercase", () => {
    const views = computeDistrictLabelViews({
      layout,
      index,
      camera: cameraAbove(60),
      focusedId: null,
      previous: new Set(),
    });
    for (const view of views) {
      const district = lookup.districtsById.get(view.id);
      expect(district).toBeDefined();
      if (!district) continue;
      expect(view.y).toBeCloseTo(district.baseY + district.height, 6);
      expect(Math.abs(view.x - district.x)).toBeLessThanOrEqual(district.width / 2 + 1e-9);
      expect(Math.abs(view.z - district.z)).toBeLessThanOrEqual(district.depth / 2 + 1e-9);
      expect(view.text).toBe(view.text.toUpperCase());
      expect(view.pixelSize).toBeGreaterThan(10);
    }
  });

  it("drops labels that would overlap on screen", () => {
    // Everything projects to the same pixel: only the first (highest priority) label survives.
    const collapsed: LabelCamera = { ...cameraAbove(40), project: () => ({ x: 400, y: 300 }) };
    const views = computeDistrictLabelViews({
      layout,
      index,
      camera: collapsed,
      focusedId: null,
      previous: new Set(),
    });
    expect(views).toHaveLength(1);
  });

  it("skips districts that project behind the camera", () => {
    const behind: LabelCamera = { ...cameraAbove(40), project: () => null };
    expect(
      computeDistrictLabelViews({
        layout,
        index,
        camera: behind,
        focusedId: null,
        previous: new Set(),
      }),
    ).toEqual([]);
  });

  it("shows fewer labels from far away", () => {
    const near = computeDistrictLabelViews({
      layout,
      index,
      camera: cameraAbove(40),
      focusedId: null,
      previous: new Set(),
    });
    const far = computeDistrictLabelViews({
      layout,
      index,
      camera: cameraAbove(4_000),
      focusedId: null,
      previous: new Set(),
    });
    expect(far.length).toBeLessThan(near.length);
  });

  it("pins the focused district first, with a statistics subline", () => {
    const focusedId = directoryId("src/payments");
    const views = computeDistrictLabelViews({
      layout,
      index,
      camera: cameraAbove(4_000),
      focusedId,
      previous: new Set(),
    });
    expect(views[0]?.id).toBe(focusedId);
    expect(views[0]?.subline).toMatch(/FILES · /);
  });

  it("stays within the label budget for large repositories", () => {
    const graph = createSyntheticGraph({ fileCount: 3_000, seed: 3 });
    const bigLayout = computeWorldLayout(graph);
    const views = computeDistrictLabelViews({
      layout: bigLayout,
      index: buildGraphIndex(graph),
      camera: cameraAbove(30),
      focusedId: null,
      previous: new Set(),
    });
    expect(views.length).toBeLessThanOrEqual(DISTRICT_LABEL_BUDGET);
  });

  it("produces a stable signature", () => {
    const input = {
      layout,
      index,
      camera: cameraAbove(60),
      focusedId: null,
      previous: new Set<string>(),
    };
    expect(labelViewsSignature(computeDistrictLabelViews(input))).toBe(
      labelViewsSignature(computeDistrictLabelViews(input)),
    );
  });
});

describe("districtSubline", () => {
  it("formats counts and marks estimated line totals", () => {
    const directory = index.directoriesById.get(directoryId("src/auth"));
    expect(directory).toBeDefined();
    if (!directory) return;
    expect(districtSubline(directory)).toMatch(/^4 FILES · 1,550 LOC$/);
    expect(
      districtSubline({ ...directory, stats: { ...directory.stats, linesEstimated: true } }),
    ).toContain("~1,550 LOC");
  });
});

describe("selectionTarget", () => {
  it("frames a selected building with a beam", () => {
    const target = selectionTarget(
      { kind: "file", id: fileId("src/auth/auth.ts") },
      layout,
      lookup,
      index,
    );
    const building = lookup.buildingsById.get(fileId("src/auth/auth.ts"));
    expect(target?.kind).toBe("building");
    expect(target?.beam).toBe(true);
    expect(target?.box.maxY).toBeCloseTo((building?.baseY ?? 0) + (building?.height ?? 0), 6);
  });

  it("frames a district without a beam and ignores the root", () => {
    expect(
      selectionTarget({ kind: "directory", id: directoryId("src") }, layout, lookup, index)?.beam,
    ).toBe(false);
    expect(
      selectionTarget({ kind: "directory", id: ROOT_DIRECTORY_ID }, layout, lookup, index),
    ).toBeNull();
  });

  it("frames a symbol by its band on the building", () => {
    const symbol = mockRepositoryGraph.symbols.find((s) => s.name === "hashPassword");
    expect(symbol).toBeDefined();
    if (!symbol) return;
    const target = selectionTarget({ kind: "symbol", id: symbol.id }, layout, lookup, index);
    const building = lookup.buildingsById.get(symbol.fileId);
    expect(target?.kind).toBe("symbol");
    expect(target && building).toBeTruthy();
    if (!target || !building) return;
    expect(target.box.minY).toBeGreaterThan(building.baseY);
    expect(target.box.maxY).toBeLessThan(building.baseY + building.height);
  });

  it("returns null for nothing or unknown nodes", () => {
    expect(selectionTarget(null, layout, lookup, index)).toBeNull();
    expect(
      selectionTarget({ kind: "file", id: "file:missing.ts" }, layout, lookup, index),
    ).toBeNull();
  });
});

describe("bracketPositions / padBox", () => {
  it("draws three arms at each of the eight corners", () => {
    const box = padBox({ minX: 0, maxX: 4, minY: 0, maxY: 10, minZ: 0, maxZ: 2 }, 0.5, 0.25);
    expect(box.minX).toBe(-0.5);
    expect(box.maxY).toBe(10.25);
    const positions = bracketPositions(box, 0.25);
    expect(positions).toHaveLength(8 * 3 * 2 * 3);
    // Every arm starts at a box corner and stays inside the box.
    for (let i = 0; i < positions.length; i += 6) {
      const [x0, y0, z0, x1, y1, z1] = Array.from(positions.slice(i, i + 6));
      expect([box.minX, box.maxX]).toContain(x0);
      expect([box.minY, box.maxY]).toContain(y0);
      expect([box.minZ, box.maxZ]).toContain(z0);
      for (const [value, min, max] of [
        [x1, box.minX, box.maxX],
        [y1, box.minY, box.maxY],
        [z1, box.minZ, box.maxZ],
      ] as const) {
        expect(value ?? Number.NaN).toBeGreaterThanOrEqual(min - 1e-6);
        expect(value ?? Number.NaN).toBeLessThanOrEqual(max + 1e-6);
      }
    }
  });
});

describe("tooltipContent", () => {
  it("describes files with their language and line count", () => {
    const content = tooltipContent({ kind: "file", id: fileId("src/auth/jwt.ts") }, index, lookup);
    expect(content).toMatchObject({ title: "jwt.ts", detail: "318 lines", language: "typescript" });
  });

  it("marks estimated line counts and describes binaries by size", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "big.ts", lines: 1200, status: "metadata-only" },
        { path: "logo.png", lines: 0, size: 2048 },
      ],
    });
    const fixtureIndex = buildGraphIndex(graph);
    const fixtureLookup = buildLayoutLookup(computeWorldLayout(graph));
    expect(
      tooltipContent({ kind: "file", id: fileId("big.ts") }, fixtureIndex, fixtureLookup)?.detail,
    ).toBe("~1,200 lines");
    expect(
      tooltipContent({ kind: "file", id: fileId("logo.png") }, fixtureIndex, fixtureLookup)?.detail,
    ).toBe("binary · 2.0 KB");
  });

  it("describes directories and symbols", () => {
    expect(
      tooltipContent({ kind: "directory", id: directoryId("src/auth") }, index, lookup)?.title,
    ).toBe("src/auth/");
    const symbol = mockRepositoryGraph.symbols.find((s) => s.name === "AuthService");
    if (!symbol) throw new Error("fixture symbol missing");
    expect(tooltipContent({ kind: "symbol", id: symbol.id }, index, lookup)).toMatchObject({
      title: "AuthService",
      detail: "class · L30–610",
    });
  });

  it("returns null for unknown nodes", () => {
    expect(tooltipContent({ kind: "file", id: "file:nope" }, index, lookup)).toBeNull();
  });
});

describe("environment math", () => {
  it("rounds grid steps to 1-2-5 sequences", () => {
    expect(niceStep(0.8)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05, 10);
    expect(niceStep(0)).toBe(1);
  });

  it("thins the fog for larger worlds", () => {
    expect(fogDensity(1_000)).toBeLessThan(fogDensity(100));
    expect(fogDensity(0)).toBeGreaterThan(0);
  });

  it("generates a deterministic dust shell", () => {
    const a = dustPositions(50, 100);
    expect(Array.from(a)).toEqual(Array.from(dustPositions(50, 100)));
    for (let i = 0; i < 50; i += 1) {
      const r = Math.hypot(a[i * 3] ?? 0, a[i * 3 + 1] ?? 0, a[i * 3 + 2] ?? 0);
      expect(r).toBeGreaterThanOrEqual(75 - 1e-6);
      expect(r).toBeLessThanOrEqual(125 + 1e-6);
    }
  });
});

describe("BandCache", () => {
  it("joins bands with their symbols in source order and caches per file", () => {
    const cache = new BandCache(index, lookup);
    const entries = cache.entriesFor(fileId("src/auth/auth.ts"));
    const file = index.filesById.get(fileId("src/auth/auth.ts"));
    expect(entries).toHaveLength(file?.symbolIds.length ?? -1);
    for (const entry of entries) {
      expect(entry.band.id).toBe(entry.symbol.id);
      expect(entry.building.id).toBe(fileId("src/auth/auth.ts"));
      expect(entry.band.y0).toBeGreaterThanOrEqual(entry.building.baseY - 1e-9);
      expect(entry.band.y1).toBeLessThanOrEqual(
        entry.building.baseY + entry.building.height + 1e-9,
      );
    }
    expect(cache.entriesFor(fileId("src/auth/auth.ts"))).toBe(entries);
  });

  it("returns nothing for files without symbols or buildings", () => {
    const cache = new BandCache(index, lookup);
    expect(cache.entriesFor(fileId("README.md"))).toEqual([]);
    expect(cache.entriesFor("file:missing.ts")).toEqual([]);
  });
});

describe("symbolLabelText", () => {
  it("truncates long names by code point", () => {
    expect(symbolLabelText("short")).toBe("short");
    const long = symbolLabelText("x".repeat(50), 10);
    expect(Array.from(long)).toHaveLength(10);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("bandPickRef", () => {
  const symbol = { id: "sym:src/auth/auth.ts#login", fileId: fileId("src/auth/auth.ts") };

  it("picks the symbol only on the selected file's bands", () => {
    expect(bandPickRef(symbol, fileId("src/auth/auth.ts"))).toEqual({
      kind: "symbol",
      id: symbol.id,
    });
  });

  it("picks the building's file on context bands of other files, or with nothing selected", () => {
    expect(bandPickRef(symbol, fileId("src/auth/jwt.ts"))).toEqual({
      kind: "file",
      id: symbol.fileId,
    });
    expect(bandPickRef(symbol, null)).toEqual({ kind: "file", id: symbol.fileId });
  });
});
