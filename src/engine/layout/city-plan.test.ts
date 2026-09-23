import { describe, expect, it } from "vitest";
import { buildFixtureGraph, createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  createCityPlan,
  isPassThroughDirectory,
  MAX_PLAN_ITERATIONS,
  solveCityPlan,
  type CityPlan,
} from "./city-plan";
import { DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { buildIntraDirectoryAdjacency } from "./file-order";
import type { LayoutGraphInput } from "./layout-input";
import { buildLayoutTree } from "./layout-tree";

function plan(graph: LayoutGraphInput): CityPlan {
  const tree = buildLayoutTree(graph);
  const adjacency = buildIntraDirectoryAdjacency(graph.dependencies, tree.directoryOfFile);
  return solveCityPlan(createCityPlan(tree, adjacency, DEFAULT_LAYOUT_OPTIONS));
}

describe("city plan", () => {
  it("converges well within the pass budget for varied repositories", () => {
    const graphs = [
      mockRepositoryGraph,
      createSyntheticGraph({ fileCount: 2_000, seed: 1 }),
      createSyntheticGraph({ fileCount: 2_000, seed: 2, filesPerDirectory: 3 }),
      createSyntheticGraph({ fileCount: 2_000, seed: 3, filesPerDirectory: 60 }),
    ];
    for (const graph of graphs) {
      const result = plan(graph);
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThan(MAX_PLAN_ITERATIONS / 2);
      for (const block of result.blocks) expect(block.fit?.fits).toBe(true);
    }
  });

  it("converges for thousands of tiny sibling directories (monorepo packages, examples)", () => {
    // Fixed-width rings dominate tiny districts, the classic failure mode of treemap cities.
    const packages = buildFixtureGraph({
      owner: "test",
      name: "monorepo",
      referenceDate: "2026-09-01T00:00:00.000Z",
      files: Array.from({ length: 2_500 }, (_, index) => ({
        path: `packages/pkg-${index}/index.ts`,
        lines: 5 + ((index * 7) % 400),
        size: 100 + ((index * 7919) % 30_000),
      })),
    });
    const singleFileDirectories = createSyntheticGraph({
      fileCount: 3_000,
      seed: 6,
      filesPerDirectory: 1,
    });
    for (const graph of [packages, singleFileDirectories]) {
      const result = plan(graph);
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThan(MAX_PLAN_ITERATIONS);
    }
  });

  it("gives every district one file block at most, holding exactly its direct files", () => {
    const result = plan(mockRepositoryGraph);
    const placed = result.blocks.flatMap((block) => block.block.files.map((file) => file.id));
    expect(new Set(placed).size).toBe(mockRepositoryGraph.files.length);
    for (const district of result.districts) {
      expect(district.block?.block.files.length ?? 0).toBe(district.directory.files.length);
    }
  });

  it("identifies pass-through directories", () => {
    const result = plan(mockRepositoryGraph);
    const passThrough = result.districts
      .filter((district) => isPassThroughDirectory(district.directory))
      .map((district) => district.directory.path);
    expect(passThrough).toEqual(
      expect.arrayContaining(["services/reports", "services/reports/src/main/java/com"]),
    );
    expect(passThrough).not.toContain("src");
    expect(passThrough).not.toContain("services");
  });
});
