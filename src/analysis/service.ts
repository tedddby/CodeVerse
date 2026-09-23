import type { AnalysisEvent } from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";
import { getGraphCache, getGraphPointerCache } from "@/lib/cache/graph-cache";
import { logger } from "@/lib/observability/logger";
import { getServerParser } from "@/parser/node";
import { createGitHubSource } from "@/sources/github";
import {
  DEFAULT_MAX_CONCURRENT_ANALYSES,
  createAnalysisService,
  type AnalysisRequest,
  type AnalysisService,
} from "./analysis-service";
import { getServerLimits } from "./server-limits";

/**
 * Server-only entry point of the analysis service (route handlers, server
 * components and metadata functions). It reads `GITHUB_TOKEN` (through the
 * GitHub provider) and the `CODEVERSE_*` configuration from the environment.
 *
 * - `streamAnalysis`: snapshot → graph cache lookup → shared (single-flight)
 *   analysis → cache store → "complete"; failures become one "error" event.
 * - `peekCachedGraph`: the latest cached graph of a repository, never network.
 * - `toErrorPayload`: failure → user-facing protocol error.
 */

export { toErrorPayload } from "./errors";
export type { AnalysisRequest } from "./analysis-service";

const SERVICE_KEY = Symbol.for("codeverse.analysis.service");

type ServiceHolder = { [SERVICE_KEY]?: AnalysisService };

/** Reads `CODEVERSE_MAX_CONCURRENT_ANALYSES` (positive integer, default 4). */
export function readMaxConcurrentAnalyses(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.CODEVERSE_MAX_CONCURRENT_ANALYSES?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_CONCURRENT_ANALYSES;
}

/** The process-wide service (kept on `globalThis` so development hot reloads share it). */
function service(): AnalysisService {
  const holder = globalThis as typeof globalThis & ServiceHolder;
  let current = holder[SERVICE_KEY];
  if (!current) {
    current = createAnalysisService({
      createSource: (request) => createGitHubSource(request),
      getParser: getServerParser,
      getLimits: getServerLimits,
      cache: getGraphCache(),
      pointers: getGraphPointerCache(),
      logger: logger.child({ component: "analysis" }),
      provider: "github",
      maxConcurrentAnalyses: readMaxConcurrentAnalyses(),
    });
    holder[SERVICE_KEY] = current;
  }
  return current;
}

/**
 * Streams the analysis of a public GitHub repository as protocol events.
 * Never throws; ends with exactly one "complete" or "error" event unless
 * `signal` aborts first.
 */
export async function streamAnalysis(
  request: AnalysisRequest,
  emit: (event: AnalysisEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return service().streamAnalysis(request, emit, signal);
}

/** Most recent cached graph for owner/repo (case-insensitive). Never triggers network requests. */
export async function peekCachedGraph(
  owner: string,
  repo: string,
): Promise<RepositoryGraph | null> {
  return service().peekCachedGraph(owner, repo);
}
