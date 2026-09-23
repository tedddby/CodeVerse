import type { AnalysisErrorCode } from "@/analysis/protocol";
import { errorPayloadFor, toErrorPayload } from "@/analysis/errors";
import { jsonResponse, retryAfterFromIso, retryAfterSeconds } from "@/app/api/_lib/http";
import { parseRepositoryParams } from "@/app/api/_lib/params";
import { logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { getSummaryRateLimiter } from "@/lib/rate-limit/limiters";
import { getClientKey } from "@/lib/rate-limit/token-bucket";
import { isSourceError } from "@/sources/types";
import { fetchRepositorySummary } from "@/sources/github";

/**
 * GET /api/repo/{owner}/{repo}
 *
 * Public metadata of a repository (`RepositorySummary`: name, description,
 * stars, languages, ...) without analysing it. Errors answer
 * `{ error: AnalysisErrorPayload }` with a matching HTTP status.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const STATUS: Record<AnalysisErrorCode, number> = {
  INVALID_REPOSITORY: 400,
  NOT_FOUND: 404,
  PRIVATE_OR_INACCESSIBLE: 403,
  RATE_LIMITED: 429,
  CLIENT_RATE_LIMITED: 429,
  UNAUTHORIZED: 502,
  EMPTY_REPOSITORY: 404,
  REF_NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
  INTERNAL: 500,
};

const routeLogger = logger.child({ route: "repo" });

export async function GET(
  request: Request,
  context: RouteContext<"/api/repo/[owner]/[repo]">,
): Promise<Response> {
  const params = parseRepositoryParams(await context.params);
  if (params === null) {
    return jsonResponse({ error: errorPayloadFor("INVALID_REPOSITORY") }, 400);
  }

  const decision = getSummaryRateLimiter().take(getClientKey(request));
  if (!decision.allowed) {
    recordMetric(METRIC_NAMES.clientRateLimited, 1, { route: "repo" });
    const retryAt = new Date(Date.now() + decision.retryAfterMs).toISOString();
    return jsonResponse({ error: errorPayloadFor("CLIENT_RATE_LIMITED", retryAt) }, 429, {
      "Retry-After": retryAfterSeconds(decision.retryAfterMs),
    });
  }

  try {
    const summary = await fetchRepositorySummary(params.owner, params.repo, request.signal);
    return jsonResponse(summary, 200, { "Cache-Control": SUCCESS_CACHE });
  } catch (error) {
    const payload = toErrorPayload(error);
    if (payload.code === "INTERNAL") routeLogger.error("repository summary failed", { error });
    else if (isSourceError(error) && error.code !== "ABORTED") {
      recordMetric(METRIC_NAMES.apiError, 1, {
        code: error.code,
        status: error.status ?? 0,
        operation: "summary",
      });
    }
    const retryAfter =
      payload.code === "RATE_LIMITED" ? retryAfterFromIso(payload.retryAt) : undefined;
    return jsonResponse(
      { error: payload },
      STATUS[payload.code],
      retryAfter ? { "Retry-After": retryAfter } : {},
    );
  }
}
