import type { AnalysisEvent } from "@/analysis/protocol";
import type { RepositoryGraph, RepositoryInfo, RepositoryProvider } from "@/graph/model/types";
import { approximateSizeOf } from "@/lib/cache/size";
import type { Cache } from "@/lib/cache/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { Logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { isValidOwner, isValidRepoName } from "@/lib/validation/repository-url";
import type { SourceParser } from "@/parser";
import { SourceError, type RepositorySource } from "@/sources/types";
import { AnalysisHub } from "./analysis-hub";
import { graphCacheKey, latestGraphPointerKey } from "./cache-key";
import { ConcurrencyGate } from "./concurrency";
import { logAnalysisSummary, type AnalysisOutcome } from "./analysis-summary";
import { toErrorPayload } from "./errors";
import { analyzeRepository } from "./pipeline";
import { abortError, monotonicNow } from "./stages/context";
import { cachedStageEvents } from "./stages/messages";

/**
 * The analysis service: cache lookup, request coalescing, concurrency
 * control and error reporting around `analyzeRepository`.
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
  /** Most recent graph key per repository, for `peekCachedGraph`. */
  pointers: Cache<string>;
  logger: Logger;
  /** Provider used to build repository ids for `peekCachedGraph` (default "github"). */
  provider?: RepositoryProvider;
  /** Clock for the pipeline (epoch milliseconds). */
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
  /** Most recent cached graph of a repository (case-insensitive); never touches the network. */
  peekCachedGraph(owner: string, repo: string): Promise<RepositoryGraph | null>;
}

export const DEFAULT_MAX_CONCURRENT_ANALYSES = 4;
const DEFAULT_QUEUE_WAIT_MS = 45_000;
const DEFAULT_HARD_TIMEOUT_GRACE_MS = 8_000;
const WAITING_MESSAGE = "Waiting for a free analysis slot";

/**
 * The analysis budget left after `elapsedMs` of resolving and queueing, never
 * below a quarter of the configured budget (a late analysis still gets a
 * useful, degraded run rather than none).
 */
export function remainingBudget(budgetMs: number, elapsedMs: number): number {
  return Math.round(Math.max(budgetMs * 0.25, budgetMs - Math.max(0, elapsedMs)));
}

/** A cached graph re-served for a request: current repository metadata, flagged as cached. */
export function asCachedGraph(
  graph: RepositoryGraph,
  repository?: RepositoryInfo,
): RepositoryGraph {
  return {
    ...graph,
    repository: repository ? { ...repository, topics: [...repository.topics] } : graph.repository,
    analysis: { ...graph.analysis, cached: true },
  };
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

  function remember(
    key: string,
    repository: RepositoryInfo,
    graph: RepositoryGraph | null,
    log: Logger,
  ) {
    const writes: Array<Promise<void>> = [];
    // Both caches update their memory tier synchronously; disk writes finish in the background.
    if (graph) writes.push(deps.cache.set(key, graph, { sizeBytes: approximateSizeOf(graph) }));
    writes.push(deps.pointers.set(latestGraphPointerKey(repository.id), key));
    for (const write of writes) {
      write.catch((error: unknown) => log.warn("graph cache write failed", { error }));
    }
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
      const snapshot = await source.getSnapshot(signal);
      const snapshotMs = Math.round(monotonicNow() - snapshotStartedAt);
      const { repository } = snapshot;
      outcome.sha = repository.commitSha;
      const key = graphCacheKey(repository, limits, source.capabilities);

      const cached = await lookup(key, log);
      recordMetric(METRIC_NAMES.cacheLookup, 1, { result: cached ? "hit" : "miss" });
      if (cached) {
        const graph = asCachedGraph(cached, repository);
        for (const event of cachedStageEvents(graph)) send(event);
        send({ type: "complete", graph });
        outcome.kind = "complete";
        outcome.cacheHit = true;
        outcome.graph = graph;
        remember(key, repository, null, log);
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
          remember(key, repository, graph, log);
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
