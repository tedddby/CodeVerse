import { describe, expect, it } from "vitest";
import { DEGRADED_GRAPH_TTL_MS } from "@/analysis/graph-freshness";
import type { AnalysisEvent } from "@/analysis/protocol";
import type { RateLimitSnapshot } from "@/graph/model/types";
import type { MemorySourceSpec } from "@/sources/memory";
import { SourceError, type RepositorySource, type SourceErrorCode } from "@/sources/types";
import { memorySource, overrideSource } from "./support/harness";
import { FIXED_NOW, polyglotSpec } from "./support/polyglot-repository";
import { collect, completedGraph, createHarness, errorOf } from "./support/service-harness";

/**
 * Cached graphs stay reachable when GitHub cannot say which commit is current,
 * degraded graphs are re-analysed once the quota recovers, replays report the
 * current quota, and the "latest graph" pointer follows the default branch
 * under both the canonical and the requested repository name.
 */

const RESET_AT = "2026-09-23T13:00:00.000Z";

function quota(limit: number, remaining: number, authenticated: boolean): RateLimitSnapshot {
  return { limit, remaining, resetAt: RESET_AT, authenticated };
}

/** A source whose snapshot fails with `failure()` whenever it returns an error code. */
function flakySource(
  spec: MemorySourceSpec,
  failure: () => SourceErrorCode | null,
): RepositorySource {
  const inner = memorySource(spec);
  return overrideSource(inner, {
    getSnapshot: (signal) => {
      const code = failure();
      if (code === null) return inner.getSnapshot(signal);
      return Promise.reject(
        new SourceError(code, "API rate limit exceeded", {
          status: 403,
          retryAt: code === "RATE_LIMITED" ? RESET_AT : undefined,
        }),
      );
    },
  });
}

function stageOf(events: AnalysisEvent[], stage: string) {
  return events.find(
    (event) => event.type === "stage" && event.stage === stage && event.status !== "start",
  );
}

function codes(graph: { analysis: { warnings: Array<{ code: string }> } }): string[] {
  return graph.analysis.warnings.map((warning) => warning.code);
}

describe("stale fallback when the snapshot cannot be resolved", () => {
  it.each(["RATE_LIMITED", "NETWORK_ERROR", "UPSTREAM_ERROR", "TIMEOUT"] as const)(
    "serves the latest cached graph on %s",
    async (code) => {
      let failing: SourceErrorCode | null = null;
      const harness = createHarness({
        source: () => flakySource(polyglotSpec({ rateLimit: quota(60, 0, false) }), () => failing),
      });
      const analysed = completedGraph(await collect(harness));
      failing = code;
      const events = await collect(harness);
      const graph = completedGraph(events);
      expect(graph.analysis.cached).toBe(true);
      expect(graph.repository.commitSha).toBe(analysed.repository.commitSha);
      expect(graph.files).toEqual(analysed.files);
      expect(codes(graph)[0]).toBe("STALE_ANALYSIS");
      const warning = graph.analysis.warnings[0];
      expect(warning?.message).toContain(analysed.repository.commitSha.slice(0, 7));
      if (code === "RATE_LIMITED") {
        expect(warning?.message).toContain(
          "rate limit has been reached (it resets at 2026-09-23 13:00 UTC)",
        );
      }
      expect(stageOf(events, "connect")).toMatchObject({ status: "warning" });
      expect(harness.counters.listTree).toBe(1);
    },
  );

  it("still reports definitive failures (not found, private) as errors", async () => {
    let failing: SourceErrorCode | null = null;
    const harness = createHarness({
      source: () => flakySource(polyglotSpec(), () => failing),
    });
    await collect(harness);
    for (const code of ["NOT_FOUND", "PRIVATE_OR_INACCESSIBLE", "REF_NOT_FOUND"] as const) {
      failing = code;
      expect(errorOf(await collect(harness)).code).toBe(code);
    }
  });

  it("reports the rate limit when nothing is cached", async () => {
    const harness = createHarness({
      source: () => flakySource(polyglotSpec(), () => "RATE_LIMITED"),
    });
    const error = errorOf(await collect(harness));
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAt).toBe(RESET_AT);
  });

  it("serves an explicitly requested commit from the cache, but not a branch name", async () => {
    let failing: SourceErrorCode | null = null;
    const harness = createHarness({
      source: () => flakySource(polyglotSpec(), () => failing),
    });
    const analysed = completedGraph(await collect(harness));
    failing = "RATE_LIMITED";
    const sha = analysed.repository.commitSha.toUpperCase();
    const pinned = completedGraph(
      await collect(harness, { owner: "acme", repo: "polyglot", ref: sha }),
    );
    expect(pinned.repository.commitSha).toBe(analysed.repository.commitSha);
    expect(codes(pinned)).toContain("STALE_ANALYSIS");

    const unknownSha = "0".repeat(40);
    expect(
      errorOf(await collect(harness, { owner: "acme", repo: "polyglot", ref: unknownSha })).code,
    ).toBe("RATE_LIMITED");
    expect(
      errorOf(await collect(harness, { owner: "acme", repo: "polyglot", ref: "main" })).code,
    ).toBe("RATE_LIMITED");
  });
});

describe("renamed repositories", () => {
  const renamed = () =>
    memorySource(
      polyglotSpec({ repository: { ...polyglotSpec().repository, owner: "new-owner" } }),
    );

  it("finds the latest graph under the requested and the canonical name", async () => {
    const harness = createHarness({ source: renamed });
    const analysed = completedGraph(
      await collect(harness, { owner: "old-owner", repo: "polyglot" }),
    );
    expect(analysed.repository.id).toBe("github:new-owner/polyglot");
    const byOldName = await harness.service.peekCachedGraph("old-owner", "polyglot");
    const byNewName = await harness.service.peekCachedGraph("New-Owner", "polyglot");
    expect(byOldName?.repository.commitSha).toBe(analysed.repository.commitSha);
    expect(byNewName?.repository.commitSha).toBe(analysed.repository.commitSha);
  });

  it("falls back to the cached graph of a renamed repository", async () => {
    let failing = false;
    const harness = createHarness({
      source: () => {
        const inner = renamed();
        return overrideSource(inner, {
          getSnapshot: (signal) =>
            failing
              ? Promise.reject(new SourceError("RATE_LIMITED", "rate limited", { status: 403 }))
              : inner.getSnapshot(signal),
        });
      },
    });
    await collect(harness, { owner: "old-owner", repo: "polyglot" });
    failing = true;
    const graph = completedGraph(await collect(harness, { owner: "old-owner", repo: "polyglot" }));
    expect(graph.analysis.cached).toBe(true);
    expect(graph.repository.fullName).toBe("new-owner/polyglot");
  });
});

describe("the latest-graph pointer", () => {
  it("only follows default-branch analyses", async () => {
    const harness = createHarness({
      source: (request) => {
        const spec = polyglotSpec();
        if (request.ref === undefined) return memorySource(spec);
        // Another branch: other content, so another commit.
        return memorySource({
          ...spec,
          repository: { ...spec.repository, ref: request.ref },
          files: { ...spec.files, "FEATURE.md": "# Feature branch\n" },
        });
      },
    });
    const main = completedGraph(await collect(harness));
    const feature = completedGraph(
      await collect(harness, { owner: "acme", repo: "polyglot", ref: "feature/x" }),
    );
    expect(feature.repository.commitSha).not.toBe(main.repository.commitSha);
    const latest = await harness.service.peekCachedGraph("acme", "polyglot");
    expect(latest?.repository.commitSha).toBe(main.repository.commitSha);
  });
});

describe("degraded graphs", () => {
  it("re-analyses a quota-degraded graph once it is older than its short lifetime", async () => {
    let clock = FIXED_NOW;
    let rateLimit = quota(60, 5, false);
    const harness = createHarness({
      source: () => {
        const spec = polyglotSpec({ rateLimit });
        return memorySource(spec);
      },
      deps: { now: () => clock },
    });
    const degraded = completedGraph(await collect(harness));
    expect(codes(degraded)).toEqual(
      expect.arrayContaining(["HISTORY_UNAVAILABLE", "RATE_LIMIT_LOW"]),
    );
    expect(degraded.commits).toHaveLength(0);

    // Within its lifetime the degraded graph is a regular cache hit.
    clock += DEGRADED_GRAPH_TTL_MS - 1_000;
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(true);
    expect(harness.counters.listTree).toBe(1);

    // The quota recovered and the lifetime is over: analysed again, with history.
    clock += 2_000;
    rateLimit = quota(60, 58, false);
    const fresh = completedGraph(await collect(harness));
    expect(harness.counters.listTree).toBe(2);
    expect(fresh.analysis.cached).toBe(false);
    expect(fresh.commits.length).toBeGreaterThan(0);
    expect(codes(fresh)).not.toContain("HISTORY_UNAVAILABLE");
    expect(codes(fresh)).not.toContain("RATE_LIMIT_LOW");
  });

  it("keeps complete graphs for their whole lifetime", async () => {
    let clock = FIXED_NOW;
    const harness = createHarness({ deps: { now: () => clock } });
    await collect(harness);
    clock += 5 * DEGRADED_GRAPH_TTL_MS;
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(true);
    expect(harness.counters.listTree).toBe(1);
  });
});

describe("quota in replayed graphs", () => {
  it("reports the current quota instead of the one stored with the graph", async () => {
    let rateLimit = quota(5_000, 400, true);
    const harness = createHarness({
      source: () => memorySource(polyglotSpec({ rateLimit })),
    });
    const analysed = completedGraph(await collect(harness));
    expect(codes(analysed)).toContain("RATE_LIMIT_LOW");
    expect(analysed.analysis.rateLimit?.remaining).toBe(400);

    rateLimit = quota(5_000, 4_900, true);
    const replayed = completedGraph(await collect(harness));
    expect(replayed.analysis.cached).toBe(true);
    expect(codes(replayed)).not.toContain("RATE_LIMIT_LOW");
    expect(replayed.analysis.rateLimit?.remaining).toBe(4_900);
    expect(harness.counters.listTree).toBe(1);
  });
});
