import { getServerLimits } from "@/analysis/server-limits";
import { retryAfterSeconds } from "@/app/api/_lib/http";
import { parseOptionalRef, parseRepositoryParams } from "@/app/api/_lib/params";
import {
  sourceErrorResponse,
  sourceFailureResponse,
  sourceFileResponse,
} from "@/app/api/_lib/source-responses";
import { raceWithSignal } from "@/github/async";
import { sanitizeRepositoryPath } from "@/github/paths";
import { isCommitSha } from "@/github/validation";
import { singleFlight } from "@/lib/cache/single-flight";
import { logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { getSourceRateLimiter } from "@/lib/rate-limit/limiters";
import { getClientKey } from "@/lib/rate-limit/token-bucket";
import { isSourceError } from "@/sources/types";
import { createGitHubSource, getSharedGitHubClient } from "@/sources/github";

/**
 * GET /api/source/{owner}/{repo}?ref={sha|branch|tag}&path={path}
 *
 * Serves one file for the source viewer, read from GitHub's raw host at an
 * exact commit (branch and tag names are resolved to a SHA first). Paths are
 * sanitized before any request: no control characters, no "." / ".."
 * segments, no leading slash, at most 1,024 characters. Identical concurrent
 * reads share one download.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLogger = logger.child({ route: "source" });

export async function GET(
  request: Request,
  context: RouteContext<"/api/source/[owner]/[repo]">,
): Promise<Response> {
  const limits = getServerLimits();
  const params = parseRepositoryParams(await context.params);
  const query = new URL(request.url).searchParams;
  const ref = parseOptionalRef(query.get("ref"));
  const rawPath = query.get("path");
  const path = rawPath === null ? null : sanitizeRepositoryPath(rawPath, limits.maxPathLength);
  if (params === null) {
    return sourceErrorResponse("INVALID_REQUEST", { message: "The repository name is not valid." });
  }
  if (ref === null || ref === undefined) {
    return sourceErrorResponse("INVALID_REQUEST", {
      message: "A valid commit SHA, branch or tag is required.",
    });
  }
  if (path === null) {
    return sourceErrorResponse("INVALID_REQUEST", { message: "The file path is not valid." });
  }

  const decision = getSourceRateLimiter().take(getClientKey(request));
  if (!decision.allowed) {
    recordMetric(METRIC_NAMES.clientRateLimited, 1, { route: "source" });
    return sourceErrorResponse("RATE_LIMITED", {
      message: "Too many files were requested in a short time. Please wait a moment.",
      headers: { "Retry-After": retryAfterSeconds(decision.retryAfterMs) },
    });
  }

  try {
    const pinned = isCommitSha(ref);
    let { owner, repo } = params;
    let sha = ref.toLowerCase();
    if (!pinned) {
      // Resolves (and caches for 60 s) the branch/tag, enforcing public visibility.
      const snapshot = await createGitHubSource({ owner, repo, ref }).getSnapshot(request.signal);
      ({ owner, name: repo, commitSha: sha } = snapshot.repository);
    }
    const flightKey = `source:${owner.toLowerCase()}/${repo.toLowerCase()}@${sha}:${path}`;
    // The shared download is not tied to one caller's signal; each caller stops waiting on its own.
    const download = singleFlight(flightKey, () =>
      getSharedGitHubClient().getRawFile(owner, repo, sha, path, {
        maxBytes: limits.maxSourceViewerBytes,
      }),
    );
    const result = await raceWithSignal(download, request.signal);
    return sourceFileResponse(result, {
      path,
      sha,
      immutable: pinned,
      maxBytes: limits.maxSourceViewerBytes,
    });
  } catch (error) {
    if (!isSourceError(error)) routeLogger.error("source request failed", { error });
    else if (error.code !== "ABORTED") {
      recordMetric(METRIC_NAMES.apiError, 1, {
        code: error.code,
        status: error.status ?? 0,
        operation: "source",
      });
    }
    return sourceFailureResponse(error);
  }
}
