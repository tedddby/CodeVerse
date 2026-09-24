import { mergeWarnings } from "@/graph/builders/assemble/report";
import type {
  AnalysisReport,
  AnalysisWarning,
  RateLimitSnapshot,
  RepositoryGraph,
} from "@/graph/model/types";
import type { SourceError } from "@/sources/types";
import { lowQuotaWarning } from "./stages/construct-stage";

/**
 * Freshness rules for cached graphs.
 *
 * - A degraded graph (data missing for transient reasons: API quota, the time
 *   budget) is served from cache for a short while only, then re-analysed.
 * - A replayed graph reports the current API quota, never the reading taken
 *   when it was analysed.
 * - When the provider cannot say which commit is current (rate limited,
 *   unreachable), the most recent cached graph is served with a warning.
 */

/** How long a degraded graph is served as a regular cache hit before it is re-analysed. */
export const DEGRADED_GRAPH_TTL_MS = 15 * 60_000;

function positive(value: string | number | boolean | undefined): boolean {
  return typeof value === "number" && value > 0;
}

/** Whether a graph misses data for transient reasons that a later analysis may not have. */
export function isDegradedGraph(graph: RepositoryGraph): boolean {
  return graph.analysis.warnings.some((warning) => {
    const detail = warning.detail ?? {};
    switch (warning.code) {
      case "HISTORY_UNAVAILABLE":
        return true;
      case "FETCH_FAILURES":
        return positive(detail.rateLimited) || positive(detail.timeBudget);
      case "PARSE_LIMIT":
        return positive(detail.stoppedEarly);
      case "HISTORY_LIMITED":
        return detail.reason === "time-budget" || detail.reason === "low-quota";
      default:
        return false;
    }
  });
}

/** Whether a cached graph is degraded and older than `DEGRADED_GRAPH_TTL_MS` at `now`. */
export function isExpiredDegradedGraph(graph: RepositoryGraph, now: number): boolean {
  if (!isDegradedGraph(graph)) return false;
  const generatedAt = Date.parse(graph.analysis.generatedAt);
  return !Number.isFinite(generatedAt) || now - generatedAt >= DEGRADED_GRAPH_TTL_MS;
}

/** The report with the stored quota reading (and its RATE_LIMIT_LOW warning) replaced by `rateLimit`. */
export function withCurrentQuota(
  analysis: AnalysisReport,
  rateLimit: RateLimitSnapshot | undefined,
  extraWarnings: readonly AnalysisWarning[] = [],
): AnalysisReport {
  const { rateLimit: _stored, ...rest } = analysis;
  const low = lowQuotaWarning(rateLimit);
  const warnings = mergeWarnings(
    [
      ...analysis.warnings.filter((warning) => warning.code !== "RATE_LIMIT_LOW"),
      ...(low ? [low] : []),
      ...extraWarnings,
    ],
    [],
  );
  return rateLimit ? { ...rest, warnings, rateLimit: { ...rateLimit } } : { ...rest, warnings };
}

/** "2026-09-23 19:37 UTC", or null for an invalid date. */
function formatUtcMinute(iso: string | undefined): string | null {
  const time = iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const text = new Date(time).toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

/** Explains why a cached graph is served although the provider could not confirm the current commit. */
export function staleAnalysisWarning(graph: RepositoryGraph, error: SourceError): AnalysisWarning {
  const reset = error.code === "RATE_LIMITED" ? formatUtcMinute(error.retryAt) : null;
  const reason =
    error.code === "RATE_LIMITED"
      ? `GitHub's API rate limit has been reached${reset ? ` (it resets at ${reset})` : ""}`
      : "GitHub could not be reached";
  const analysed = formatUtcMinute(graph.analysis.generatedAt);
  return {
    code: "STALE_ANALYSIS",
    message: `${reason}, so CodeVerse could not check for newer commits. Showing the cached analysis of commit ${graph.repository.commitSha.slice(0, 7)}${analysed ? ` from ${analysed}` : ""}.`,
    detail: { reason: error.code, commitSha: graph.repository.commitSha },
  };
}
