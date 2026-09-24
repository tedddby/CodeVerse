import { describe, expect, it } from "vitest";
import type { AnalysisEvent } from "@/analysis/protocol";
import { FETCH_REASONS, MAX_CONSECUTIVE_RATE_LIMITS } from "@/analysis/stages/fetch-stage";
import { expectConsistent } from "@/graph/builders/test-consistency";
import type { SourceParser } from "@/parser";
import { SourceError, type RepositorySource } from "@/sources/types";
import {
  fileByPath,
  finalStageEvents,
  memorySource,
  overrideSource,
  realParser,
  runPipeline,
} from "./support/harness";
import { COMMITS, FILES, polyglotSpec } from "./support/polyglot-repository";

/**
 * The pipeline degrades instead of failing: limits are honoured, per-file and
 * history failures become statuses and warnings, provider throttling stops
 * downloads early, and cancellation stops everything.
 */

const source = () => memorySource(polyglotSpec());

function warningCodes(graph: { analysis: { warnings: Array<{ code: string }> } }): string[] {
  return graph.analysis.warnings.map((warning) => warning.code);
}

function finalOf(events: AnalysisEvent[], stage: string) {
  return finalStageEvents(events).find((event) => event.stage === stage);
}

describe("limits", () => {
  it("parses at most maxParsedFiles files and says so", async () => {
    const { graph } = await runPipeline(source(), { limits: { maxParsedFiles: 3 } });
    expectConsistent(graph);
    const analysed = graph.files.filter(
      (file) => file.status === "parsed" || file.status === "partial",
    );
    expect(analysed).toHaveLength(3);
    expect(warningCodes(graph)).toContain("PARSE_LIMIT");
    const skipped = graph.files.filter((file) =>
      file.statusReason?.includes("parse limit of 3 files"),
    );
    expect(skipped.length).toBeGreaterThan(0);
    for (const file of skipped) expect(file.status).toBe("metadata-only");
  });

  it("never downloads more than maxTotalBytes", async () => {
    const reads: string[] = [];
    const inner = source();
    const counting = overrideSource(inner, {
      readFile: (snapshot, path, options) => {
        reads.push(path);
        return inner.readFile(snapshot, path, options);
      },
    });
    const { graph } = await runPipeline(counting, { limits: { maxTotalBytes: 4_096 } });
    expectConsistent(graph);
    expect(graph.analysis.coverage.bytesDownloaded).toBeLessThanOrEqual(4_096);
    expect(warningCodes(graph)).toContain("BYTE_LIMIT");
    expect(reads.length).toBeLessThan(Object.keys(FILES).length);
    expect(graph.files.some((file) => file.statusReason?.includes("download budget"))).toBe(true);
  });

  it("switches to directory-first above the tier thresholds", async () => {
    const { graph } = await runPipeline(source(), {
      limits: { tierFullMax: 5, tierProgressiveMax: 10 },
    });
    expect(graph.analysis.tier).toBe("directory-first");
    expect(warningCodes(graph)).toContain("LARGE_REPOSITORY");
  });

  it("keeps at most maxFiles buildings while directory totals cover the whole tree", async () => {
    const { graph } = await runPipeline(source(), { limits: { maxFiles: 10 } });
    expectConsistent(graph);
    expect(graph.files).toHaveLength(10);
    expect(graph.analysis.coverage.filesInRepository).toBe(Object.keys(FILES).length);
    expect(warningCodes(graph)).toContain("FILE_NODE_LIMIT");
  });

  it("stops starting work when the analysis time budget runs out", async () => {
    let clock = Date.parse("2026-09-23T12:00:00.000Z");
    const events: AnalysisEvent[] = [];
    const { graph } = await runPipeline(source(), {
      limits: { analysisBudgetMs: 1 },
      now: () => (clock += 1_000),
      onEvent: (event) => events.push(event),
    });
    expectConsistent(graph);
    expect(graph.analysis.coverage.bytesDownloaded).toBe(0);
    expect(fileByPath(graph, "apps/web/src/index.ts")).toMatchObject({
      status: "metadata-only",
      statusReason: FETCH_REASONS.timeBudget,
    });
    expect(warningCodes(graph)).toEqual(
      expect.arrayContaining(["FETCH_FAILURES", "HISTORY_LIMITED"]),
    );
    // Both gaps are transient: the graph is marked for an early re-analysis.
    const byCode = new Map(graph.analysis.warnings.map((entry) => [entry.code, entry]));
    expect(byCode.get("FETCH_FAILURES")?.detail?.timeBudget).toBeGreaterThan(0);
    expect(byCode.get("HISTORY_LIMITED")?.detail?.reason).toBe("time-budget");
    expect(finalOf(events, "fetch")?.status).toBe("warning");
    expect(finalOf(events, "history")?.status).toBe("warning");
    expect(events[events.length - 1]?.type).toBe("complete");
  });
});

describe("failure isolation", () => {
  it("turns a parser failure into a failed file without affecting the others", async () => {
    const parser = realParser();
    const flaky: SourceParser = {
      warmup: (languages) => parser.warmup(languages),
      parse: (input, options) =>
        input.path === "internal/store/store.go"
          ? Promise.resolve({
              ok: false,
              reason: "timeout",
              message: "Parsing timed out",
              lines: 6,
            })
          : parser.parse(input, options),
    };
    const { graph } = await runPipeline(source(), { parser: flaky });
    expect(fileByPath(graph, "internal/store/store.go")).toMatchObject({
      status: "failed",
      statusReason: "Parsing timed out after 2s",
      lines: 6,
    });
    expect(fileByPath(graph, "cmd/server/main.go").status).toBe("parsed");
    // The import still resolves to the file; only its own symbols are missing.
    expect(graph.dependencies.map((edge) => edge.id)).toContain(
      "import:file:cmd/server/main.go->file:internal/store/store.go",
    );
  });

  it("keeps going when a parser rejects unexpectedly", async () => {
    const parser = realParser();
    const throwing: SourceParser = {
      warmup: (languages) => parser.warmup(languages),
      parse: (input, options) =>
        input.path.endsWith(".py")
          ? Promise.reject(new Error("wasm trap"))
          : parser.parse(input, options),
    };
    const { graph } = await runPipeline(source(), { parser: throwing });
    expect(fileByPath(graph, "python/acme/models.py").status).toBe("failed");
    expect(fileByPath(graph, "apps/web/src/index.ts").status).toBe("parsed");
  });
});

describe("provider rate limits", () => {
  function rateLimitedReads(inner: RepositorySource, isLimited: (call: number) => boolean) {
    const calls: string[] = [];
    const wrapped = overrideSource(inner, {
      readFile: async (snapshot, path, options) => {
        calls.push(path);
        if (isLimited(calls.length)) {
          throw new SourceError("RATE_LIMITED", "throttled", {
            retryAt: "2026-09-23T13:00:00.000Z",
          });
        }
        return inner.readFile(snapshot, path, options);
      },
    });
    return { wrapped, calls };
  }

  it(`stops downloading after ${MAX_CONSECUTIVE_RATE_LIMITS} consecutive rate-limited reads`, async () => {
    const { wrapped, calls } = rateLimitedReads(source(), () => true);
    const events: AnalysisEvent[] = [];
    const { graph } = await runPipeline(wrapped, {
      limits: { fetchConcurrency: 1 },
      onEvent: (event) => events.push(event),
    });
    expectConsistent(graph);
    expect(calls).toHaveLength(MAX_CONSECUTIVE_RATE_LIMITS);
    expect(fileByPath(graph, "apps/web/src/index.ts")).toMatchObject({
      status: "metadata-only",
      statusReason: FETCH_REASONS.rateLimited,
    });
    const warning = graph.analysis.warnings.find((entry) => entry.code === "FETCH_FAILURES");
    expect(warning?.message).toMatch(/rate limit was reached/);
    expect(finalOf(events, "fetch")).toMatchObject({
      status: "warning",
      message: "Stopped early: GitHub rate limit reached",
    });
    expect(finalOf(events, "parse")?.status).toBe("skipped");
    expect(events[events.length - 1]?.type).toBe("complete");
  });

  it("keeps downloading when rate-limited reads are not consecutive", async () => {
    const inner = source();
    const { wrapped, calls } = rateLimitedReads(inner, (call) => call % 2 === 0);
    const { graph } = await runPipeline(wrapped, { limits: { fetchConcurrency: 1 } });
    const planned = graph.files.filter((file) => file.status !== "binary").length;
    expect(calls.length).toBeGreaterThanOrEqual(planned - 1);
    expect(
      graph.files.filter((file) => file.statusReason === FETCH_REASONS.rateLimited).length,
    ).toBe(Math.floor(calls.length / 2));
  });

  it("warns when the provider quota is nearly exhausted", async () => {
    const { graph } = await runPipeline(
      memorySource(
        polyglotSpec({
          rateLimit: {
            limit: 60,
            remaining: 4,
            resetAt: "2026-09-23T12:45:00.000Z",
            authenticated: false,
          },
        }),
      ),
    );
    const warning = graph.analysis.warnings.find((entry) => entry.code === "RATE_LIMIT_LOW");
    expect(warning?.message).toContain("4 of 60 requests left");
    expect(warning?.message).toContain("12:45 UTC");
    expect(graph.analysis.rateLimit).toMatchObject({ remaining: 4, limit: 60 });
  });
});

describe("cancellation", () => {
  it("rejects with ABORTED, stops downloading and emits no terminal event", async () => {
    const controller = new AbortController();
    const inner = memorySource(polyglotSpec({ readDelayMs: 20 }));
    let reads = 0;
    const counting = overrideSource(inner, {
      readFile: (snapshot, path, options) => {
        reads += 1;
        if (reads === 2) controller.abort();
        return inner.readFile(snapshot, path, options);
      },
    });
    const events: AnalysisEvent[] = [];
    const run = runPipeline(counting, {
      signal: controller.signal,
      limits: { fetchConcurrency: 1 },
      onEvent: (event) => events.push(event),
    });
    await expect(run).rejects.toSatisfy(
      (error) => error instanceof SourceError && error.code === "ABORTED",
    );
    expect(reads).toBeLessThanOrEqual(2);
    expect(events.some((event) => event.type === "complete" || event.type === "error")).toBe(false);
  });

  it("does nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: AnalysisEvent[] = [];
    await expect(
      runPipeline(source(), { signal: controller.signal, onEvent: (event) => events.push(event) }),
    ).rejects.toSatisfy((error) => error instanceof SourceError && error.code === "ABORTED");
    expect(events).toEqual([]);
  });
});

describe("optional history", () => {
  it("completes without history when commits cannot be listed", async () => {
    const inner = source();
    const events: AnalysisEvent[] = [];
    const { graph } = await runPipeline(
      overrideSource(inner, {
        listCommits: () =>
          Promise.reject(new SourceError("UPSTREAM_ERROR", "boom", { status: 502 })),
      }),
      { onEvent: (event) => events.push(event) },
    );
    expectConsistent(graph);
    expect(graph.commits).toEqual([]);
    expect(warningCodes(graph)).toContain("HISTORY_UNAVAILABLE");
    expect(finalOf(events, "history")).toMatchObject({
      status: "warning",
      message: "Commit history unavailable",
    });
    expect(graph.files.filter((file) => file.status === "parsed").length).toBeGreaterThan(10);
  });

  it("explains a history outage caused by the rate limit", async () => {
    const { graph } = await runPipeline(
      overrideSource(source(), {
        listCommits: () =>
          Promise.reject(new SourceError("RATE_LIMITED", "quota", { status: 403 })),
      }),
    );
    const warning = graph.analysis.warnings.find((entry) => entry.code === "HISTORY_UNAVAILABLE");
    expect(warning?.message).toMatch(/rate limit/);
  });

  it("falls back to sampled activity when per-file history and commit counts fail", async () => {
    const { graph } = await runPipeline(
      overrideSource(source(), {
        getFileActivity: () => Promise.reject(new SourceError("UNAUTHORIZED", "no token")),
        getCommitCounts: () => Promise.reject(new SourceError("UPSTREAM_ERROR", "graphql down")),
      }),
    );
    expectConsistent(graph);
    expect(graph.analysis.history.perFileHistory).toBe(false);
    expect(graph.timeline.coverage).toBe("sampled");
    expect(graph.commits).toHaveLength(3);
    // Activity still comes from the fetched commit details.
    expect(fileByPath(graph, "crates/core/src/lib.rs").activity?.lastAuthorId).toBe("user:ada");
  });

  it("tolerates failing commit details and contributor lists", async () => {
    const { graph } = await runPipeline(
      overrideSource(source(), {
        getCommitDetails: () => Promise.reject(new SourceError("NOT_FOUND", "gone")),
        listContributors: () => Promise.reject(new SourceError("UPSTREAM_ERROR", "down")),
      }),
    );
    expectConsistent(graph);
    expect(graph.analysis.history.commitsWithDetails).toBe(0);
    expect(graph.contributors.map((contributor) => contributor.id).sort()).toEqual([
      "user:ada",
      "user:grace",
    ]);
  });

  it("skips per-file lookups and exact counts when the provider cannot offer them", async () => {
    const { graph } = await runPipeline(
      memorySource(polyglotSpec({ capabilities: { fileHistory: false, commitCounts: false } })),
    );
    expect(graph.analysis.history.perFileHistory).toBe(false);
    expect(graph.timeline.coverage).toBe("sampled");
  });
});

describe("extraction limits", () => {
  it("caps symbols and imports of a generated file and marks it partial", async () => {
    const functions = Array.from({ length: 2_600 }, (_, index) => `export function f${index}() {}`);
    const imports = Array.from({ length: 1_200 }, (_, index) => `import "./m${index}";`);
    const spec = polyglotSpec();
    const generated = "packages/gen/src/api.ts";
    const { graph } = await runPipeline(
      memorySource({
        ...spec,
        files: { ...spec.files, [generated]: `${[...imports, ...functions].join("\n")}\n` },
      }),
      { limits: { maxParseBytes: 256 * 1024, maxFileBytes: 256 * 1024 } },
    );
    expectConsistent(graph);
    const file = fileByPath(graph, generated);
    expect(file.status).toBe("partial");
    expect(file.symbolIds).toHaveLength(2_000);
    expect(file.imports).toHaveLength(1_000);
    expect(file.statusReason).toBe(
      "Symbol limit reached: kept 2,000 of 2,600 symbols, 1,000 of 1,200 imports and 2,000 of 2,600 exports",
    );
    expect(warningCodes(graph)).toContain("SYMBOL_LIMIT");
    // Other files are untouched.
    expect(fileByPath(graph, "apps/web/src/index.ts").status).toBe("parsed");
  });
});

describe("imported history", () => {
  it("keeps commits older than the repository's creation date in the full-history timeline", async () => {
    const spec = polyglotSpec();
    const [latest] = COMMITS;
    if (!latest) throw new Error("fixture has commits");
    const imported = {
      ...latest,
      sha: "f".repeat(40),
      message: "Initial import from the old VCS",
      date: "2019-05-01T00:00:00Z",
      files: [],
    };
    const { graph } = await runPipeline(memorySource({ ...spec, commits: [...COMMITS, imported] }));
    expect(graph.timeline.coverage).toBe("full-history");
    expect(graph.timeline.start).toBe("2019-01-01T00:00:00.000Z");
    expect(graph.timeline.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(
      COMMITS.length + 1,
    );
  });
});
