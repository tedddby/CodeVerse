import { describe, expect, it } from "vitest";
import { computeWorldLayout } from "@/engine/layout/compute-layout";
import { RENDER_HEX } from "@/engine/rendering/palette";
import { buildFixtureGraph, createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { FileNode } from "@/graph/model/types";
import { getLanguageColor } from "@/lib/languages/registry";
import { byDepth, type IsoBox } from "../iso";
import { architectureColor, buildPosterScene, drawsBefore, paintersOrder } from "./poster-scene";

function box(x: number, z: number, size = 1): IsoBox {
  return { x, z, width: size, depth: size, height: 1 };
}

/** No box may be drawn after a box it has to be hidden behind. */
function expectValidPaintersOrder(boxes: readonly IsoBox[]) {
  for (let later = 0; later < boxes.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      const a = boxes[earlier];
      const b = boxes[later];
      if (a && b) expect(drawsBefore(b, a)).toBe(false);
    }
  }
}

describe("drawsBefore", () => {
  it("puts boxes behind on X or Z (with overlapping extents) first", () => {
    expect(drawsBefore(box(0, 0), box(2, 0))).toBe(true);
    expect(drawsBefore(box(0, 0), box(0, 2))).toBe(true);
    expect(drawsBefore(box(2, 0), box(0, 0))).toBe(false);
    expect(drawsBefore(box(0, 2), box(0, 0))).toBe(false);
  });

  it("puts boxes behind on both axes first", () => {
    expect(drawsBefore(box(0, 0), box(3, 3))).toBe(true);
    expect(drawsBefore(box(3, 3), box(0, 0))).toBe(false);
  });

  it("has no constraint between boxes whose projections cannot overlap", () => {
    // Behind on X but in front on Z: they sit side by side on screen.
    expect(drawsBefore(box(0, 3), box(3, 0))).toBe(false);
    expect(drawsBefore(box(3, 0), box(0, 3))).toBe(false);
  });

  it("treats touching footprints as ordered", () => {
    expect(drawsBefore(box(0, 0), box(1, 0))).toBe(true);
  });
});

describe("paintersOrder", () => {
  it("fixes the case a center-depth sort gets wrong (long building beside a small one)", () => {
    // The long building's center is nearer to the viewer, yet the small one stands
    // in front of its right-hand face and must be drawn last.
    const long = { x: 0, z: 2, width: 6, depth: 10, height: 2 };
    const small = { x: 3.5, z: -2.5, width: 1, depth: 1, height: 2 };
    expect([long, small].sort(byDepth)).toEqual([small, long]);
    expect(drawsBefore(long, small)).toBe(true);
    expect(paintersOrder([small, long])).toEqual([long, small]);
  });

  it("orders a dense grid far-to-near", () => {
    const grid = Array.from({ length: 25 }, (_, index) =>
      box((index % 5) * 1.2, Math.floor(index / 5) * 1.2),
    );
    const ordered = paintersOrder([...grid].reverse());
    expect(ordered).toHaveLength(grid.length);
    expectValidPaintersOrder(ordered);
  });
});

describe("architectureColor", () => {
  const file = (overrides: Partial<FileNode>) =>
    ({
      language: "typescript",
      category: "source",
      isGenerated: false,
      status: "parsed",
      ...overrides,
    }) as FileNode;

  it("uses the language color for source files", () => {
    expect(architectureColor(file({}))).toBe(getLanguageColor("typescript"));
  });

  it("mutes tests, docs, config and generated or vendored files", () => {
    const source = architectureColor(file({}));
    for (const muted of [
      file({ category: "test" }),
      file({ category: "docs" }),
      file({ category: "config" }),
      file({ category: "vendor" }),
      file({ isGenerated: true }),
    ]) {
      expect(architectureColor(muted)).not.toBe(source);
    }
    // Generated files are muted more strongly than tests.
    const channelSpread = (hex: string) => {
      const channels = [1, 3, 5].map((offset) =>
        Number.parseInt(hex.slice(offset, offset + 2), 16),
      );
      return Math.max(...channels) - Math.min(...channels);
    };
    expect(channelSpread(architectureColor(file({ isGenerated: true })))).toBeLessThan(
      channelSpread(architectureColor(file({ category: "test" }))),
    );
  });

  it("uses the renderer's neutral colors for binary and unknown files", () => {
    expect(architectureColor(file({ status: "binary" }))).toBe(RENDER_HEX.binary);
    expect(architectureColor(undefined)).toBe(RENDER_HEX.neutral);
  });
});

describe("buildPosterScene", () => {
  it("projects the engine's own layout: one building per file, same geometry", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    const scene = buildPosterScene(mockRepositoryGraph, layout);
    expect(scene.buildings).toHaveLength(mockRepositoryGraph.files.length);
    expect(new Set(scene.buildings.map((building) => building.id))).toEqual(
      new Set(mockRepositoryGraph.files.map((file) => file.id)),
    );
    const byId = new Map(layout.buildings.map((building) => [building.id, building]));
    for (const building of scene.buildings) {
      const source = byId.get(building.id);
      expect(source).toBeDefined();
      expect(building).toMatchObject({
        x: source?.x,
        z: source?.z,
        width: source?.width,
        depth: source?.depth,
        height: source?.height,
        baseY: source?.baseY,
      });
    }
    expect(scene.districts).toHaveLength(layout.districts.length);
  });

  it("labels only top-level districts, with their directory names", () => {
    const scene = buildPosterScene(mockRepositoryGraph);
    const labels = scene.districts
      .filter((district) => district.label)
      .map((district) => district.label);
    const topLevel = mockRepositoryGraph.directories
      .filter((directory) => directory.depth === 1)
      .map((directory) => directory.name);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(topLevel).toContain(label);
    for (const district of scene.districts) {
      if (district.level !== 1) expect(district.label).toBeUndefined();
    }
  });

  it("draws terraces bottom-up and buildings in a valid painter's order", () => {
    const scene = buildPosterScene(mockRepositoryGraph);
    const levels = scene.districts.map((district) => district.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expectValidPaintersOrder(scene.buildings);
  });

  it("stays valid on a larger synthetic repository", () => {
    const graph = createSyntheticGraph({ fileCount: 400, seed: 11 });
    const scene = buildPosterScene(graph);
    expect(scene.buildings).toHaveLength(400);
    expectValidPaintersOrder(scene.buildings);
  });

  it("is deterministic", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "a/one.ts", lines: 10 },
        { path: "a/two.ts", lines: 300 },
        { path: "b/three.py", lines: 90 },
        { path: "README.md", lines: 40 },
      ],
    });
    expect(buildPosterScene(graph)).toEqual(buildPosterScene(graph));
  });
});
