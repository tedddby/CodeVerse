import { describe, expect, it } from "vitest";
import { runPipeline } from "@/graph/builders/test-pipeline";
import type { AnalysisWarning, RateLimitSnapshot, RepositoryGraph } from "@/graph/model/types";
import { SourceError } from "@/sources/types";
import {
  DEGRADED_GRAPH_TTL_MS,
  isDegradedGraph,
  isExpiredDegradedGraph,
  staleAnalysisWarning,
  withCurrentQuota,
} from "./graph-freshness";

const files = [{ path: "src/index.ts" }, { path: "README.md" }];

function graphWith(warnings: AnalysisWarning[]): RepositoryGraph {
  return runPipeline({
    files,
    warnings,
    history: {
      commits: [],
      details: [],
      contributors: [],
      fileActivity: new Map(),
      commitCounts: null,
      perFileHistory: false,
    },
  }).graph;
}

const warning = (
  code: AnalysisWarning["code"],
  detail?: AnalysisWarning["detail"],
): AnalysisWarning => (detail ? { code, message: code, detail } : { code, message: code });

describe("isDegradedGraph", () => {
  it.each([
    ["history unavailable", warning("HISTORY_UNAVAILABLE")],
    [
      "rate-limited downloads",
      warning("FETCH_FAILURES", { rateLimited: 3, failed: 0, notDownloaded: 0, timeBudget: 0 }),
    ],
    [
      "downloads cut by the time budget",
      warning("FETCH_FAILURES", { rateLimited: 0, failed: 0, notDownloaded: 9, timeBudget: 9 }),
    ],
    [
      "parsing cut by the time budget",
      warning("PARSE_LIMIT", { parsed: 10, eligible: 20, stoppedEarly: 10 }),
    ],
    ["history trimmed by the time budget", warning("HISTORY_LIMITED", { reason: "time-budget" })],
    ["history reduced by a low quota", warning("HISTORY_LIMITED", { reason: "low-quota" })],
  ])("flags %s", (_label, entry) => {
    expect(isDegradedGraph(graphWith([entry]))).toBe(true);
  });

  it.each([
    ["no warnings", []],
    [
      "the fixed unauthenticated history caps",
      [warning("HISTORY_LIMITED", { reason: "unauthenticated" })],
    ],
    [
      "the byte budget",
      [warning("FETCH_FAILURES", { rateLimited: 0, failed: 0, notDownloaded: 4, timeBudget: 0 })],
    ],
    [
      "failed downloads",
      [warning("FETCH_FAILURES", { rateLimited: 0, failed: 2, notDownloaded: 0, timeBudget: 0 })],
    ],
    ["the parse limit", [warning("PARSE_LIMIT", { parsed: 10, eligible: 20 })]],
    ["a low quota at the end", [warning("RATE_LIMIT_LOW", { remaining: 3, limit: 60 })]],
  ])("does not flag %s", (_label, entries) => {
    expect(isDegradedGraph(graphWith(entries))).toBe(false);
  });

  it("expires degraded graphs only", () => {
    const degraded = graphWith([warning("HISTORY_UNAVAILABLE")]);
    const complete = graphWith([]);
    const analysedAt = Date.parse(degraded.analysis.generatedAt);
    expect(isExpiredDegradedGraph(degraded, analysedAt + DEGRADED_GRAPH_TTL_MS - 1)).toBe(false);
    expect(isExpiredDegradedGraph(degraded, analysedAt + DEGRADED_GRAPH_TTL_MS)).toBe(true);
    expect(isExpiredDegradedGraph(complete, analysedAt + 100 * DEGRADED_GRAPH_TTL_MS)).toBe(false);
  });
});

describe("withCurrentQuota", () => {
  const stored: RateLimitSnapshot = {
    limit: 60,
    remaining: 3,
    resetAt: "2026-09-23T13:00:00.000Z",
    authenticated: false,
  };

  it("replaces the stored reading and its low-quota warning", () => {
    const graph = graphWith([warning("RATE_LIMIT_LOW", { remaining: 3, limit: 60 })]);
    graph.analysis.rateLimit = stored;
    const current = { ...stored, remaining: 58, resetAt: "2026-09-23T14:00:00.000Z" };
    const report = withCurrentQuota(graph.analysis, current);
    expect(report.rateLimit).toEqual(current);
    expect(report.warnings.map((entry) => entry.code)).not.toContain("RATE_LIMIT_LOW");

    const unknown = withCurrentQuota(graph.analysis, undefined);
    expect(unknown).not.toHaveProperty("rateLimit");
    expect(graph.analysis.rateLimit).toEqual(stored);
  });

  it("warns about the current low quota and keeps warnings in display order", () => {
    const graph = graphWith([warning("HISTORY_UNAVAILABLE")]);
    const stale = staleAnalysisWarning(
      graph,
      new SourceError("RATE_LIMITED", "limited", { retryAt: "2026-09-23T13:00:00.000Z" }),
    );
    const report = withCurrentQuota(graph.analysis, stored, [stale]);
    expect(report.warnings.map((entry) => entry.code)).toEqual([
      "STALE_ANALYSIS",
      "HISTORY_UNAVAILABLE",
      "RATE_LIMIT_LOW",
    ]);
    expect(stale.message).toBe(
      `GitHub's API rate limit has been reached (it resets at 2026-09-23 13:00 UTC), so CodeVerse could not check for newer commits. Showing the cached analysis of commit ${graph.repository.commitSha.slice(0, 7)} from ${graph.analysis.generatedAt.slice(0, 10)} ${graph.analysis.generatedAt.slice(11, 16)} UTC.`,
    );
  });

  it("explains an unreachable GitHub", () => {
    const graph = graphWith([]);
    const stale = staleAnalysisWarning(graph, new SourceError("NETWORK_ERROR", "offline"));
    expect(stale.message.startsWith("GitHub could not be reached, so CodeVerse")).toBe(true);
    expect(stale.detail).toMatchObject({ reason: "NETWORK_ERROR" });
  });
});
