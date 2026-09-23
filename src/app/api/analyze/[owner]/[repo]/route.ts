import { errorPayloadFor } from "@/analysis/errors";
import { createAnalysisStreamResponse, ndjsonErrorResponse } from "@/analysis/ndjson-stream";
import { streamAnalysis } from "@/analysis/service";
import { logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { getAnalyzeRateLimiter } from "@/lib/rate-limit/limiters";
import { getClientKey } from "@/lib/rate-limit/token-bucket";
import { retryAfterSeconds } from "@/app/api/_lib/http";
import { parseOptionalRef, parseRepositoryParams } from "@/app/api/_lib/params";

/**
 * GET /api/analyze/{owner}/{repo}[?ref=branch|tag|sha]
 *
 * Streams the analysis as NDJSON (see `@/analysis/protocol`). Invalid input
 * answers 400 and an exhausted per-client quota 429, both with a single NDJSON
 * error event so the client can use the same parser for every response.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds; the analysis budget (`analysisBudgetMs`) keeps real runs well below it. */
export const maxDuration = 120;

const routeLogger = logger.child({ route: "analyze" });

export async function GET(
  request: Request,
  context: RouteContext<"/api/analyze/[owner]/[repo]">,
): Promise<Response> {
  const params = parseRepositoryParams(await context.params);
  const ref = parseOptionalRef(new URL(request.url).searchParams.get("ref"));
  if (params === null || ref === null) {
    return ndjsonErrorResponse(400, errorPayloadFor("INVALID_REPOSITORY"));
  }

  const limiter = getAnalyzeRateLimiter();
  if (limiter) {
    const decision = limiter.take(getClientKey(request));
    if (!decision.allowed) {
      recordMetric(METRIC_NAMES.clientRateLimited, 1, { route: "analyze" });
      const retryAt = new Date(Date.now() + decision.retryAfterMs).toISOString();
      return ndjsonErrorResponse(429, errorPayloadFor("CLIENT_RATE_LIMITED", retryAt), {
        "Retry-After": retryAfterSeconds(decision.retryAfterMs),
      });
    }
  }

  const analysisRequest = ref === undefined ? params : { ...params, ref };
  return createAnalysisStreamResponse(
    (emit, signal) => streamAnalysis(analysisRequest, emit, signal),
    {
      signal: request.signal,
      onError: (error) => routeLogger.error("analysis stream failed", { error }),
    },
  );
}
