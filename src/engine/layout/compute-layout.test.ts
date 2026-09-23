import { describe, expect, it } from "vitest";
import { buildFixtureGraph, createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { directoryId, fileId } from "@/graph/model/ids";
import {
  computeWorldLayout,
  DEFAULT_LAYOUT_OPTIONS,
  districtLabelSize,
  MAX_LABEL_SIZE,
  MIN_LABEL_SIZE,
} from "./compute-layout";
import { PASS_THROUGH_RING_SCALE } from "./city-plan";
import { roundCoordinate } from "./geometry";
import { toLayoutInput } from "./layout-input";
import { buildingFootprint, buildingHeight } from "./metrics";
import {
  boxOf,
  collectLayoutViolations,
  contains,
  shuffleGraph,
  withoutDuration,
} from "./test-support";
import { LAYOUT_VERSION, type WorldLayout } from "./types";

const REFERENCE_DATE = "2026-09-01T00:00:00.000Z";

function fixture(files: Array<{ path: string; lines: number; size?: number; imports?: string[] }>) {
  return buildFixtureGraph({ owner: "test", name: "repo", referenceDate: REFERENCE_DATE, files });
}

function districtOf(layout: WorldLayout, id: string) {
  const district = layout.districts.find((item) => item.id === id);
  if (!district) throw new Error(`no district ${id}`);
  return district;
}

function buildingOf(layout: WorldLayout, id: string) {
  const building = layout.buildings.find((item) => item.id === id);
  if (!building) throw new Error(`no building ${id}`);
  return building;
}

describe("computeWorldLayout", () => {
  it("produces a versioned, keyed layout for the mock repository", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    expect(layout.version).toBe(LAYOUT_VERSION);
    expect(layout.key).toBe(
      `${mockRepositoryGraph.repository.id}@${mockRepositoryGraph.repository.commitSha}`,
    );
    expect(layout.durationMs).toBeGreaterThanOrEqual(0);
    expect(layout.buildings).toHaveLength(mockRepositoryGraph.files.length);
  });

  it("satisfies every structural invariant on the mock repository", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    expect(collectLayoutViolations(mockRepositoryGraph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual(
      [],
    );
  });

  it("satisfies every structural invariant on a synthetic 3,000-file repository", () => {
    const graph = createSyntheticGraph({ fileCount: 3_000, seed: 11 });
    const layout = computeWorldLayout(graph);
    expect(collectLayoutViolations(graph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual([]);
  });

  it("satisfies the invariants for many small directories and for one huge flat directory", () => {
    const small = createSyntheticGraph({ fileCount: 2_000, seed: 5, filesPerDirectory: 2 });
    expect(
      collectLayoutViolations(small, computeWorldLayout(small), DEFAULT_LAYOUT_OPTIONS),
    ).toEqual([]);
    const flat = createSyntheticGraph({ fileCount: 2_000, seed: 5, filesPerDirectory: 1_000_000 });
    expect(flat.directories).toHaveLength(1);
    expect(collectLayoutViolations(flat, computeWorldLayout(flat), DEFAULT_LAYOUT_OPTIONS)).toEqual(
      [],
    );
  });

  it("is deterministic across runs", () => {
    const graph = createSyntheticGraph({ fileCount: 1_500, seed: 21 });
    const first = computeWorldLayout(graph);
    const second = computeWorldLayout(graph);
    expect(JSON.stringify(withoutDuration(second))).toBe(JSON.stringify(withoutDuration(first)));
  });

  it("does not depend on the order of the graph's arrays", () => {
    for (const graph of [
      mockRepositoryGraph,
      createSyntheticGraph({ fileCount: 1_200, seed: 8 }),
    ]) {
      const reference = JSON.stringify(withoutDuration(computeWorldLayout(graph)));
      for (const seed of [1, 2, 3]) {
        const shuffled = shuffleGraph(graph, seed);
        expect(JSON.stringify(withoutDuration(computeWorldLayout(shuffled)))).toBe(reference);
      }
    }
  });

  it("gives the same result for the compact worker input as for the full graph", () => {
    const graph = createSyntheticGraph({ fileCount: 800, seed: 4 });
    expect(withoutDuration(computeWorldLayout(toLayoutInput(graph)))).toEqual(
      withoutDuration(computeWorldLayout(graph)),
    );
  });

  it("sizes buildings with the metric functions when nothing had to be scaled", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    for (const file of mockRepositoryGraph.files) {
      const building = buildingOf(layout, file.id);
      expect(building.width).toBe(roundCoordinate(buildingFootprint(file, DEFAULT_LAYOUT_OPTIONS)));
      expect(building.depth).toBe(building.width);
      expect(building.height).toBe(roundCoordinate(buildingHeight(file, DEFAULT_LAYOUT_OPTIONS)));
    }
  });

  it("terraces nested districts one slab above their parent", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    const slab = DEFAULT_LAYOUT_OPTIONS.slabHeight;
    const root = districtOf(layout, mockRepositoryGraph.rootDirectoryId);
    expect(root.level).toBe(0);
    expect(root.baseY).toBe(0);
    const handlers = districtOf(layout, directoryId("src/api/handlers"));
    expect(handlers.level).toBe(3);
    expect(handlers.baseY).toBeCloseTo(3 * slab, 6);
    expect(buildingOf(layout, fileId("src/api/handlers/auth.ts")).baseY).toBeCloseTo(4 * slab, 6);
  });

  it("keeps nested districts one district padding inside their parent", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    const padding = DEFAULT_LAYOUT_OPTIONS.districtPadding;
    let passThroughCount = 0;
    for (const directory of mockRepositoryGraph.directories) {
      if (!directory.parentId) continue;
      const parentNode = mockRepositoryGraph.directories.find(
        (item) => item.id === directory.parentId,
      );
      // Pass-through parents (no files, a single child) use a thinner ring.
      const passThrough =
        parentNode?.fileIds.length === 0 && parentNode.childDirectoryIds.length === 1;
      if (passThrough) passThroughCount += 1;
      const margin = passThrough ? padding * PASS_THROUGH_RING_SCALE : padding;
      const parent = boxOf(districtOf(layout, directory.parentId));
      expect(contains(parent, boxOf(districtOf(layout, directory.id)), margin)).toBe(true);
    }
    expect(passThroughCount).toBeGreaterThan(3);
  });

  it("keeps pass-through package chains compact", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    const leaf = districtOf(layout, directoryId("services/reports/src/main/java/com/acme/reports"));
    const top = districtOf(layout, directoryId("services/reports"));
    // Six pass-through levels add far less than six full padding rings on each side.
    expect(top.width - leaf.width).toBeLessThan(
      6 * 2 * DEFAULT_LAYOUT_OPTIONS.districtPadding * 0.5,
    );
  });

  it("keeps dependency-related files next to each other inside a district", () => {
    // A chain of imports (03 -> 37 -> 21) among files that are far apart in path order.
    const importsOf = (index: number) =>
      index === 3 ? ["pkg/file37.ts"] : index === 37 ? ["pkg/file21.ts"] : undefined;
    const build = (withImports: boolean) =>
      computeWorldLayout(
        fixture(
          Array.from({ length: 40 }, (_, index) => ({
            path: `pkg/file${String(index).padStart(2, "0")}.ts`,
            // 03 is the largest file and 37 the smallest: size order alone puts them far apart.
            lines: index === 3 ? 900 : index === 37 ? 12 : 40 + ((index * 37) % 300),
            imports: withImports ? importsOf(index) : undefined,
          })),
        ),
      );
    const distance = (layout: WorldLayout, a: string, b: string) => {
      const first = buildingOf(layout, fileId(a));
      const second = buildingOf(layout, fileId(b));
      return Math.hypot(first.x - second.x, first.z - second.z);
    };
    const linked = build(true);
    const unlinked = build(false);
    const neighbourDistance =
      DEFAULT_LAYOUT_OPTIONS.maxFootprint + DEFAULT_LAYOUT_OPTIONS.buildingGap * 4;
    expect(distance(linked, "pkg/file03.ts", "pkg/file37.ts")).toBeLessThan(neighbourDistance);
    expect(distance(linked, "pkg/file37.ts", "pkg/file21.ts")).toBeLessThan(neighbourDistance);
    expect(distance(unlinked, "pkg/file03.ts", "pkg/file37.ts")).toBeGreaterThan(
      distance(linked, "pkg/file03.ts", "pkg/file37.ts"),
    );
  });

  it("respects custom options", () => {
    const options = { ...DEFAULT_LAYOUT_OPTIONS, districtPadding: 4, buildingGap: 1.5 };
    const layout = computeWorldLayout(mockRepositoryGraph, options);
    expect(collectLayoutViolations(mockRepositoryGraph, layout, options)).toEqual([]);
    expect(layout.bounds.size).toBeGreaterThan(computeWorldLayout(mockRepositoryGraph).bounds.size);
  });

  it("repairs invalid options instead of producing NaN geometry", () => {
    const layout = computeWorldLayout(mockRepositoryGraph, {
      districtPadding: Number.NaN,
      minFootprint: -3,
      maxFootprint: 0.5,
      maxHeight: Number.POSITIVE_INFINITY,
    });
    const numbers = JSON.stringify(withoutDuration(layout)).match(/null|NaN|Infinity/g);
    expect(numbers).toBeNull();
    expect(
      collectLayoutViolations(mockRepositoryGraph, layout, {
        ...DEFAULT_LAYOUT_OPTIONS,
        maxFootprint: DEFAULT_LAYOUT_OPTIONS.minFootprint,
      }),
    ).toEqual([]);
  });

  it("scales label sizes with the district", () => {
    const layout = computeWorldLayout(createSyntheticGraph({ fileCount: 600, seed: 2 }));
    for (const district of layout.districts) {
      expect(district.labelSize).toBeGreaterThanOrEqual(MIN_LABEL_SIZE);
      expect(district.labelSize).toBeLessThanOrEqual(MAX_LABEL_SIZE);
    }
    const root = layout.districts[0];
    const smallest = [...layout.districts].sort((a, b) => a.width * a.depth - b.width * b.depth)[0];
    expect(root && smallest && root.labelSize > smallest.labelSize).toBe(true);
  });
});

describe("districtLabelSize", () => {
  it("grows with the district and is clamped", () => {
    expect(districtLabelSize(4, 4, "src")).toBe(MIN_LABEL_SIZE);
    expect(districtLabelSize(40, 40, "src")).toBeGreaterThan(districtLabelSize(20, 20, "src"));
    expect(districtLabelSize(10_000, 10_000, "src")).toBe(MAX_LABEL_SIZE);
  });

  it("shrinks long names so they fit the district width", () => {
    expect(districtLabelSize(30, 30, "a-really-long-directory-name")).toBeLessThan(
      districtLabelSize(30, 30, "lib"),
    );
  });
});
