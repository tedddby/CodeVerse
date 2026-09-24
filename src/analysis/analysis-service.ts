import type { AnalysisEvent } from "@/analysis/protocol";
import type {
  AnalysisWarning,
  RateLimitSnapshot,
  RepositoryGraph,
  RepositoryInfo,
  RepositoryProvider,
} from "@/graph/model/types";
import { approximateSizeOf } from "@/lib/cache/size";
import type { Cache } from "@/lib/cache/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { Logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { isValidOwner, isValidRepoName } from "@/lib/validation/repository-url";
import type { SourceParser } from "@/parser";
import {
  SourceError,
  isSourceError,
  type RepositorySource,
  type SourceCapabilities,
  type SourceErrorCode,
  type SourceSnapshot,
} from "@/sources/types";
import { AnalysisHub } from "./analysis-hub";
import { graphCacheKey, latestGraphPointerKey } from "./cache-key";
import { ConcurrencyGate } from "./concurrency";
import { logAnalysisSummary, type AnalysisOutcome } from "./analysis-summary";
import { toErrorPayload } from "./errors";
import { isExpiredDegradedGraph, staleAnalysisWarning, withCurrentQuota } from "./graph-freshness";
import { analyzeRepository } from "./pipeline";
import { abortError, monotonicNow } from "./stages/context";
import { cachedStageEvents } from "./stages/messages";

/**
 * The analysis service: cache lookup, request coalescing, concurrency
 * control and error reporting around `analyzeRepository`.
 *
 * Cache policy (see also `graph-freshness.ts`):
 * - graphs are keyed by repository, commit and settings, so the provider is
 *   asked for the current commit first;
 * - when it cannot answer for a transient reason (rate limit, network,
 *   upstream error, timeout), the latest cached graph of the default branch,
 *   or the cached graph of an explicitly requested commit, is served with a
 *   STALE_ANALYSIS warning instead of an error;
 * - degraded graphs are re-analysed after `DEGRADED_GRAPH_TTL_MS`;
 * - the "latest graph" pointer (`peekCachedGraph`, the stale fallback) only
 *   follows default-branch analyses, under the canonical and the requested
 *   repository name (renamed and transferred repositories).
 *
 * Built from injected dependencies so it can be exercised with in-memory
 * sources and caches; `service.ts` wires the production instance.
 */

export interface AnalysisRequest {
  owner: string;
  repo: string;
  ref?: string;
}

export interface AnalysisServiceDeps {
  /** Creates the provider source; may throw `SourceError("INVALID_REPOSITORY")`. */
  createSource(request: AnalysisRequest): RepositorySource;
  getParser(): SourceParser;
  getLimits(): AnalysisLimits;
  cache: Cache<RepositoryGraph>;
  /** Most recent default-branch graph key per repository, for `peekCachedGraph`. */
  pointers: Cache<string>;
  logger: Logger;
  /** Provider used to build repository ids for `peekCachedGraph` (default "github"). */
  provider?: RepositoryProvider;
  /** Clock for the pipeline and cache freshness (epoch milliseconds). */
  now?: () => number;
  /** Analyses allowed to run at once (default 4). */
  maxConcurrentAnalyses?: number;
  /** Longest wait for a free analysis slot (default 45 s). */
  maxQueueWaitMs?: number;
  /** Time past `analysisBudgetMs` after which a running analysis is aborted with TIMEOUT (default 8 s). */
  hardTimeoutGraceMs?: number;
}

export interface AnalysisService {
  /**
   * Streams one analysis as protocol events. Never throws: failures become
   * one "error" event. When `signal` aborts (client gone) it returns without
   * a terminal event. Otherwise exactly one "complete" or "error" is emitted.
   */
  streamAnalysis(
    request: AnalysisRequest,
    emit: (event: AnalysisEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** Most recent cached default-branch graph of a repository (case-insensitive); never touches the network. */
  peekCachedGraph(owner: string, repo: string): Promise<RepositoryGraph | null>;
}

export const DEFAULT_MAX_CONCURRENT_ANALYSES = 4;
const DEFAULT_QUEUE_WAIT_MS = 45_000;
const DEFAULT_HARD_TIMEOUT_GRACE_MS = 8_000;
const WAITING_MESSAGE = "Waiting for a free analysis slot";
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** Snapshot failures after which a cached graph is served instead of an error. */
const STALE_FALLBACK_CODES: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>([
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "TIMEOUT",
]);

/**
 * The analysis budget left after `elapsedMs` of resolving and queueing, never
 * below a quarter of the configured budget (a late analysis still gets a
 * useful, degraded run rather than none).
 */
export function remainingBudget(budgetMs: number, elapsedMs: number): number {
  return Math.round(Math.max(budgetMs * 0.25, budgetMs - Math.max(0, elapsedMs)));
}

/**
 * A cached graph re-served for a request: current repository metadata and API
 * quota (a stored quota reading is always stale), flagged as cached.
 */
export function asCachedGraph(
  graph: RepositoryGraph,
  repository?: RepositoryInfo,
  rateLimit?: RateLimitSnapshot,
  extraWarnings: readonly AnalysisWarning[] = [],
): RepositoryGraph {
  return {
    ...graph,
    repository: repository ? { ...repository, topics: [...repository.topics] } : graph.repository,
    analysis: { ...withCurrentQuota(graph.analysis, rateLimit, extraWarnings), cached: true },
  };
}

/** Whether an analysis describes the default branch (the only one the "latest" pointer follows). */
function isDefaultBranchRequest(request: AnalysisRequest, repository: RepositoryInfo): boolean {
  return request.ref === undefined || request.ref === repository.defaultBranch;
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  const hub = new AnalysisHub();
  const gate = new ConcurrencyGate(deps.maxConcurrentAnalyses ?? DEFAULT_MAX_CONCURRENT_ANALYSES);
  const provider = deps.provider ?? "github";
  const now = deps.now ?? Date.now;

  async function lookup(key: string, log: Logger): Promise<RepositoryGraph | undefined> {
    try {
      return await deps.cache.get(key);
    } catch (error) {
      log.warn("graph cache read failed", { error });
      return undefined;
    }
  }

  /** The graph a repository's "latest" pointer designates, or undefined. Never throws. */
  async function latestCachedGraph(
    owner: string,
    repo: string,
    log: Logger,
  ): Promise<RepositoryGraph | undefined> {
    let key: string | undefined;
    try {
      key = await deps.pointers.get(latestGraphPointerKey(`${provider}:${owner}/${repo}`));
    } catch (error) {
      log.warn("graph pointer read failed", { error });
      return undefined;
    }
    return key ? lookup(key, log) : undefined;
  }

  /**
   * Stores a graph and, for default-branch analyses, points the repository's
   * "latest" pointer at it, under the canonical name and the requested one
   * (a renamed repository is still found under its old URL).
   */
  function remember(
    key: string,
    request: AnalysisRequest,
    repository: RepositoryInfo,
    graph: RepositoryGraph | null,
    log: Logger,
  ) {
    const writes: Array<Promise<void>> = [];
    // Both caches update their memory tier synchronously; disk writes finish in the background.
    if (graph) writes.push(deps.cache.set(key, graph, { sizeBytes: approximateSizeOf(graph) }));
    if (isDefaultBranchRequest(request, repository)) {
      const pointers = new Set([
        latestGraphPointerKey(repository.id),
        latestGraphPointerKey(`${provider}:${request.owner}/${request.repo}`),
      ]);
      for (const pointer of pointers) writes.push(deps.pointers.set(pointer, key));
    }
    for (const write of writes) {
      write.catch((error: unknown) => log.warn("graph cache write failed", { error }));
    }
  }

  /**
   * The cached graph to serve when the snapshot could not be resolved, or
   * null. Only transient failures qualify (a repository that is now missing or
   * private must not be served), and only requests the cache can answer: the
   * default branch (its latest graph) or a full commit SHA.
   */
  async function staleFallback(
    request: AnalysisRequest,
    error: unknown,
    limits: AnalysisLimits,
    capabilities: SourceCapabilities,
    log: Logger,
  ): Promise<RepositoryGraph | null> {
    if (!isSourceError(error) || !STALE_FALLBACK_CODES.has(error.code)) return null;
    if (request.ref !== undefined && !FULL_COMMIT_SHA.test(request.ref)) return null;
    const latest = await latestCachedGraph(request.owner, request.repo, log);
    if (!latest) return null;
    if (request.ref === undefined) return latest;
    const sha = request.ref.toLowerCase();
    if (latest.repository.commitSha.toLowerCase() === sha) return latest;
    const key = graphCacheKey({ id: latest.repository.id, commitSha: sha }, limits, capabilities);
    return (await lookup(key, log)) ?? null;
  }

  async function streamAnalysis(
    request: AnalysisRequest,
    emit: (event: AnalysisEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = monotonicNow();
    const log = deps.logger.child({ repo: `${request.owner}/${request.repo}`, ref: request.ref });
    let terminalSent = false;
    const send = (event: AnalysisEvent) => {
      if (terminalSent || signal.aborted) return;
      if (event.type === "complete" || event.type === "error") terminalSent = true;
      try {
        emit(event);
      } catch (error) {
        log.warn("analysis event consumer failed", { error });
      }
    };
    const outcome: AnalysisOutcome = { kind: "error", cacheHit: false, shared: false };

    try {
      send({ type: "stage", stage: "connect", status: "start" });
      if (signal.aborted) throw abortError();
      const source = deps.createSource(request);
      const limits = deps.getLimits();
      const snapshotStartedAt = monotonicNow();
      let snapshot: SourceSnapshot;
      try {
        snapshot = await source.getSnapshot(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        const stale = await staleFallback(request, error, limits, source.capabilities, log);
        if (!stale || !isSourceError(error)) throw error;
        log.info("serving a cached graph: the snapshot could not be resolved", {
          code: error.code,
          sha: stale.repository.commitSha,
        });
        const graph = asCachedGraph(stale, undefined, source.getRateLimit(), [
          staleAnalysisWarning(stale, error),
        ]);
        for (const event of cachedStageEvents(graph, true)) send(event);
        send({ type: "complete", graph });
        outcome.kind = "complete";
        outcome.cacheHit = true;
        outcome.graph = graph;
        outcome.sha = graph.repository.commitSha;
        return;
      }
      const snapshotMs = Math.round(monotonicNow() - snapshotStartedAt);
      const { repository } = snapshot;
      outcome.sha = repository.commitSha;
      const key = graphCacheKey(repository, limits, source.capabilities);

      const stored = await lookup(key, log);
      // A degraded graph is re-analysed once its short lifetime is over; the cache
      // keeps it meanwhile for the stale fallback.
      const cached = stored && !isExpiredDegradedGraph(stored, now()) ? stored : undefined;
      recordMetric(METRIC_NAMES.cacheLookup, 1, {
        result: cached ? "hit" : stored ? "expired" : "miss",
      });
      if (cached) {
        const graph = asCachedGraph(cached, repository, source.getRateLimit());
        for (const event of cachedStageEvents(graph)) send(event);
        send({ type: "complete", graph });
        outcome.kind = "complete";
        outcome.cacheHit = true;
        outcome.graph = graph;
        remember(key, request, repository, null, log);
        return;
      }

      const run = async (broadcast: (event: AnalysisEvent) => void, flightSignal: AbortSignal) => {
        const release = await gate.acquire(
          flightSignal,
          deps.maxQueueWaitMs ?? DEFAULT_QUEUE_WAIT_MS,
          () =>
            broadcast({
              type: "stage",
              stage: "connect",
              status: "progress",
              message: WAITING_MESSAGE,
            }),
        );
        // Time spent resolving and queueing counts against the request's budget.
        const budgetMs = remainingBudget(limits.analysisBudgetMs, monotonicNow() - startedAt);
        const deadline = AbortSignal.timeout(
          budgetMs + (deps.hardTimeoutGraceMs ?? DEFAULT_HARD_TIMEOUT_GRACE_MS),
        );
        try {
          const graph = await analyzeRepository(source, {
            limits: { ...limits, analysisBudgetMs: budgetMs },
            parser: deps.getParser(),
            emit: broadcast,
            logger: log,
            signal: AbortSignal.any([flightSignal, deadline]),
            now,
            snapshot,
          });
          graph.analysis.timings.connect = snapshotMs;
          graph.analysis.durationMs += snapshotMs;
          remember(key, request, repository, graph, log);
          return graph;
        } catch (error) {
          if (deadline.aborted && !flightSignal.aborted) {
            throw new SourceError("TIMEOUT", "The analysis exceeded its time limit.");
          }
          throw error;
        } finally {
          release();
        }
      };

      const joined = await hub.join(key, run, send, signal);
      // A request that joined another one's analysis reports its own (fresh) repository metadata.
      const graph = joined.shared
        ? { ...joined.graph, repository: { ...repository, topics: [...repository.topics] } }
        : joined.graph;
      outcome.shared = joined.shared;
      send({ type: "complete", graph });
      outcome.kind = "complete";
      outcome.graph = graph;
    } catch (error) {
      if (signal.aborted) {
        outcome.kind = "cancelled";
        return;
      }
      outcome.error = error;
      send({ type: "error", error: toErrorPayload(error) });
    } finally {
      logAnalysisSummary(log, outcome, monotonicNow() - startedAt);
    }
  }

  async function peekCachedGraph(owner: string, repo: string): Promise<RepositoryGraph | null> {
    if (!isValidOwner(owner) || !isValidRepoName(repo)) return null;
    try {
      const key = await deps.pointers.get(latestGraphPointerKey(`${provider}:${owner}/${repo}`));
      if (!key) return null;
      const graph = await deps.cache.get(key);
      return graph ? asCachedGraph(graph) : null;
    } catch (error) {
      deps.logger.warn("graph cache peek failed", { error });
      return null;
    }
  }

  return { streamAnalysis, peekCachedGraph };
}
