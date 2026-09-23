import type { RepositoryGraph } from "@/graph/model/types";
import type { Logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { isSourceError } from "@/sources/types";
import { toErrorPayload } from "./errors";

/**
 * The per-request summary of an analysis: one structured log line and the
 * request-level metrics. Only ids, counts and codes are logged, never
 * repository content or provider messages (except for INTERNAL failures,
 * whose redacted error is logged for debugging).
 */

export interface AnalysisOutcome {
  kind: "complete" | "error" | "cancelled";
  cacheHit: boolean;
  /** The request joined an analysis started by another request. */
  shared: boolean;
  graph?: RepositoryGraph;
  error?: unknown;
  sha?: string;
}

/** One structured line per analysis request (no secrets: ids, counts and codes only). */
export function logAnalysisSummary(log: Logger, outcome: AnalysisOutcome, wallMs: number): void {
  const durationMs = Math.round(wallMs);
  recordMetric(METRIC_NAMES.analysisDuration, durationMs, {
    outcome: outcome.kind,
    cached: outcome.cacheHit,
  });
  if (outcome.kind === "cancelled") {
    log.info("analysis cancelled by client", { sha: outcome.sha, durationMs });
    return;
  }
  if (outcome.kind === "error") {
    const payload = toErrorPayload(outcome.error);
    const fields = {
      sha: outcome.sha,
      durationMs,
      code: payload.code,
      status: isSourceError(outcome.error) ? outcome.error.status : undefined,
    };
    if (payload.code === "INTERNAL")
      log.error("analysis failed", { ...fields, error: outcome.error });
    else log.info("analysis failed", fields);
    if (isSourceError(outcome.error) && outcome.error.code !== "ABORTED") {
      recordMetric(METRIC_NAMES.apiError, 1, {
        code: outcome.error.code,
        status: outcome.error.status ?? 0,
        operation: "analysis",
      });
    }
    return;
  }
  const graph = outcome.graph;
  const coverage = graph?.analysis.coverage;
  log.info("analysis complete", {
    repo: graph?.repository.fullName,
    sha: outcome.sha,
    tier: graph?.analysis.tier,
    files: coverage?.filesInGraph,
    parsed: coverage ? coverage.filesParsed + coverage.filesPartial : undefined,
    failures: coverage?.filesFailed,
    warnings: graph?.analysis.warnings.map((warning) => warning.code),
    durationMs,
    cacheHit: outcome.cacheHit,
    shared: outcome.shared,
  });
}
