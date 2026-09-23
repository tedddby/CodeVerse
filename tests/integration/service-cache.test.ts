import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_STAGES } from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";
import { FileSystemCache } from "@/lib/cache/file-system-cache";
import { isStoredGraph } from "@/lib/cache/graph-cache";
import { MemoryCache } from "@/lib/cache/memory-cache";
import { TieredCache } from "@/lib/cache/tiered-cache";
import type { Cache } from "@/lib/cache/types";
import { memorySource, overrideSource, testLimits } from "./support/harness";
import { polyglotSpec } from "./support/polyglot-repository";
import { collect, completedGraph, createHarness, terminalEvents } from "./support/service-harness";

/**
 * The analysis service and the graph cache: replay of cached graphs, cache
 * keys, failure tolerance, the disk tier across restarts, `peekCachedGraph`.
 */

describe("graph cache", () => {
  it("analyses once, then replays cached graphs without touching file contents", async () => {
    const harness = createHarness();
    const first = await collect(harness);
    expect(terminalEvents(first)).toHaveLength(1);
    const analysed = completedGraph(first);
    expect(analysed.analysis.cached).toBe(false);
    expect(harness.counters.readFile).toBeGreaterThan(0);
    expect(first.some((event) => event.type === "preview")).toBe(true);

    const reads = harness.counters.readFile;
    const second = await collect(harness);
    expect(harness.counters.readFile).toBe(reads);
    expect(harness.counters.listTree).toBe(1);
    const replayed = second.filter((event) => event.type === "stage");
    expect(replayed[0]).toEqual({ type: "stage", stage: "connect", status: "start" });
    expect(
      replayed
        .slice(1)
        .map((event) => (event.type === "stage" ? `${event.stage}:${event.status}` : "")),
    ).toEqual(ANALYSIS_STAGES.map((stage) => `${stage}:done`));
    expect(
      replayed.find((event) => event.type === "stage" && event.stage === "fetch"),
    ).toMatchObject({
      message: "Cached",
    });
    const cached = completedGraph(second);
    expect(cached.analysis.cached).toBe(true);
    expect(cached.files).toEqual(analysed.files);
    expect(terminalEvents(second)).toHaveLength(1);
  });

  it("serves cached structure with fresh repository metadata", async () => {
    let stars = 10;
    const harness = createHarness({
      source: () =>
        memorySource(polyglotSpec({ repository: { ...polyglotSpec().repository, stars } })),
    });
    await collect(harness);
    stars = 99;
    const graph = completedGraph(await collect(harness));
    expect(graph.analysis.cached).toBe(true);
    expect(graph.repository.stars).toBe(99);
  });

  it("re-analyses when the analysis settings change", async () => {
    let limits = testLimits();
    const harness = createHarness({ deps: { getLimits: () => limits } });
    await collect(harness);
    limits = testLimits({ maxParsedFiles: 2 });
    const graph = completedGraph(await collect(harness));
    expect(harness.counters.listTree).toBe(2);
    expect(graph.analysis.cached).toBe(false);
    expect(graph.analysis.limits.maxParsedFiles).toBe(2);
  });

  it("treats cache read failures as misses and cache write failures as harmless", async () => {
    const broken: Cache<RepositoryGraph> = {
      get: () => Promise.reject(new Error("disk unavailable")),
      set: () => Promise.reject(new Error("disk full")),
      delete: () => Promise.resolve(),
    };
    const harness = createHarness({ deps: { cache: broken } });
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(false);
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(false);
    expect(harness.counters.listTree).toBe(2);
  });

  it("survives a restart through the disk tier", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codeverse-service-"));
    try {
      const tiered = () =>
        new TieredCache<RepositoryGraph>([
          new MemoryCache({ maxBytes: 64 * 1024 * 1024 }),
          new FileSystemCache({ directory, validate: isStoredGraph }),
        ]);
      const disk = new FileSystemCache<string>({ directory: path.join(directory, "latest") });
      const before = createHarness({ deps: { cache: tiered(), pointers: disk } });
      const analysed = completedGraph(await collect(before));
      // Disk writes complete in the background; wait until the record is readable.
      const probe = new FileSystemCache<RepositoryGraph>({ directory, validate: isStoredGraph });
      for (let attempt = 0; attempt < 100 && !(await probeAny(probe)); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const after = createHarness({ deps: { cache: tiered(), pointers: disk } });
      const graph = completedGraph(await collect(after));
      expect(after.counters.listTree).toBe(0);
      expect(graph.analysis.cached).toBe(true);
      expect(graph.symbols).toEqual(analysed.symbols);
      expect(await after.service.peekCachedGraph("acme", "polyglot")).not.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** Whether a graph record has been written to the disk tier. */
async function probeAny(cache: FileSystemCache<RepositoryGraph>): Promise<boolean> {
  const names = await readdir(cache.directory).catch((): string[] => []);
  return names.some((name) => name.endsWith(".json.gz"));
}

describe("peekCachedGraph", () => {
  it("returns the latest cached graph case-insensitively without touching the provider", async () => {
    const harness = createHarness();
    expect(await harness.service.peekCachedGraph("acme", "polyglot")).toBeNull();
    const analysed = completedGraph(await collect(harness));
    const sourcesCreated = harness.counters.createSource;

    const peeked = await harness.service.peekCachedGraph("ACME", "PolyGlot");
    expect(peeked?.repository.commitSha).toBe(analysed.repository.commitSha);
    expect(peeked?.analysis.cached).toBe(true);
    expect(harness.counters.createSource).toBe(sourcesCreated);
  });

  it("returns null for invalid names and unknown repositories", async () => {
    const harness = createHarness();
    await collect(harness);
    expect(await harness.service.peekCachedGraph("acme", "..")).toBeNull();
    expect(await harness.service.peekCachedGraph("-bad-", "polyglot")).toBeNull();
    expect(await harness.service.peekCachedGraph("acme", "other")).toBeNull();
  });
});

describe("timings", () => {
  it("reports the snapshot resolution as the connect timing", async () => {
    const harness = createHarness({
      source: () =>
        overrideSource(memorySource(polyglotSpec()), {
          getSnapshot: async (signal) => {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return memorySource(polyglotSpec()).getSnapshot(signal);
          },
        }),
    });
    const graph = completedGraph(await collect(harness));
    expect(graph.analysis.timings.connect).toBeGreaterThanOrEqual(20);
  });
});
