import { describe, expect, it } from "vitest";
import { createSyntheticGraph } from "@/fixtures/fixture-builder";
import { computeWorldLayout, DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { toLayoutInput } from "./layout-input";
import { collectLayoutViolations } from "./test-support";

/**
 * Performance budget: the worker must lay out 25k files / 5k directories in
 * well under 1.5 s on a typical laptop. Node on CI is the reference here, with
 * a generous 2 s ceiling so the test is not flaky on slow runners.
 */
const BUDGET_MS = 2_000;

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

describe("computeWorldLayout performance", () => {
  it("lays out 20,000 files within budget and stays valid", () => {
    const graph = createSyntheticGraph({ fileCount: 20_000 });
    computeWorldLayout(createSyntheticGraph({ fileCount: 500, seed: 2 })); // JIT warm-up
    const { value: layout, ms } = timed(() => computeWorldLayout(graph));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(layout.buildings).toHaveLength(20_000);
    expect(collectLayoutViolations(graph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual([]);
  });

  it("lays out 25,000 files in 5,000 directories within budget", () => {
    const graph = createSyntheticGraph({ fileCount: 25_000, seed: 9, filesPerDirectory: 5 });
    expect(graph.directories.length).toBeGreaterThanOrEqual(5_000);
    const { value: layout, ms } = timed(() => computeWorldLayout(graph));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(layout.districts).toHaveLength(graph.directories.length);
  });

  it("keeps the worker payload compact for large graphs", () => {
    const graph = createSyntheticGraph({ fileCount: 25_000, seed: 3 });
    const full = timed(() => structuredClone(graph));
    const compact = timed(() => structuredClone(toLayoutInput(graph)));
    // Building + cloning the compact input must be cheaper than cloning the full graph.
    expect(compact.ms).toBeLessThan(full.ms);
    expect(JSON.stringify(compact.value).length).toBeLessThan(JSON.stringify(graph).length / 2);
  });
});
