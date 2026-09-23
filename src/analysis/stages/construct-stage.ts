import { assembleGraph, type AssembleInput } from "@/graph/builders/assemble";
import type { AnalysisWarning, RateLimitSnapshot, RepositoryGraph } from "@/graph/model/types";
import { METRIC_NAMES, recordMetric, startTimer } from "@/lib/observability/metrics";
import { formatInteger } from "@/lib/utils/format";
import type { PipelineContext } from "./context";
import { CONSTRUCT_COMPLETE } from "./messages";

/**
 * Stage "construct": assembles the final RepositoryGraph, adds end-of-run
 * warnings (provider quota), finalizes timings and emits "complete".
 */

/** Share of the provider quota below which RATE_LIMIT_LOW is raised. */
export const LOW_QUOTA_SHARE = 0.1;

export type ConstructInput = Omit<
  AssembleInput,
  "warnings" | "timings" | "startedAt" | "finishedAt" | "rateLimit" | "limits"
>;

function formatUtcTime(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return `${new Date(time).toISOString().slice(11, 16)} UTC`;
}

/** RATE_LIMIT_LOW when less than 10% of the provider quota is left. */
export function lowQuotaWarning(rateLimit: RateLimitSnapshot | undefined): AnalysisWarning | null {
  if (
    !rateLimit ||
    !(rateLimit.limit > 0) ||
    rateLimit.remaining >= rateLimit.limit * LOW_QUOTA_SHARE
  ) {
    return null;
  }
  const reset = formatUtcTime(rateLimit.resetAt);
  return {
    code: "RATE_LIMIT_LOW",
    message: `The server's GitHub API quota is running low (${formatInteger(rateLimit.remaining)} of ${formatInteger(rateLimit.limit)} requests left)${reset ? `; it resets at ${reset}` : ""}. New analyses may be incomplete until then.`,
    detail: {
      remaining: rateLimit.remaining,
      limit: rateLimit.limit,
      authenticated: rateLimit.authenticated,
    },
  };
}

function sortedTimings(timings: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(timings).sort()) {
    const value = timings[key];
    if (value !== undefined && Number.isFinite(value)) sorted[key] = value;
  }
  return sorted;
}

export function runConstructStage(
  context: PipelineContext,
  input: ConstructInput,
  rateLimit: RateLimitSnapshot | undefined,
): RepositoryGraph {
  const stage = context.startStage("construct");
  const quotaWarning = lowQuotaWarning(rateLimit);
  if (quotaWarning) context.addWarning(quotaWarning);
  if (rateLimit) {
    recordMetric(METRIC_NAMES.rateLimitRemaining, rateLimit.remaining, {
      authenticated: rateLimit.authenticated,
    });
  }

  const endBuildTimer = startTimer(METRIC_NAMES.graphBuildDuration);
  const graph = assembleGraph({
    ...input,
    limits: context.limits,
    warnings: [...context.warnings],
    timings: { ...context.timings },
    startedAt: context.startedAt,
    finishedAt: context.now(),
    ...(rateLimit ? { rateLimit } : {}),
  });
  endBuildTimer();
  stage.finish("done", CONSTRUCT_COMPLETE);

  // Assembly itself belongs to the analysis duration and to the "construct" timing.
  const finishedAt = context.now();
  graph.analysis.timings = sortedTimings({ ...graph.analysis.timings, ...context.timings });
  if (Number.isFinite(finishedAt) && Number.isFinite(context.startedAt)) {
    graph.analysis.durationMs = Math.max(0, Math.round(finishedAt - context.startedAt));
    graph.analysis.generatedAt = new Date(finishedAt).toISOString();
  }

  const { coverage } = graph.analysis;
  recordMetric(METRIC_NAMES.filesInGraph, coverage.filesInGraph);
  recordMetric(METRIC_NAMES.filesParsed, coverage.filesParsed + coverage.filesPartial);
  recordMetric(METRIC_NAMES.parseFailures, coverage.filesFailed);
  recordMetric(METRIC_NAMES.bytesDownloaded, coverage.bytesDownloaded);

  context.emit({ type: "complete", graph });
  return graph;
}
