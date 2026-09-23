import type { AnalysisEvent } from "@/analysis/protocol";
import { buildPreviewGraph } from "@/graph/builders/assemble";
import {
  buildInventory,
  determineTier,
  planContentFetch,
  selectGraphFiles,
} from "@/graph/builders/inventory";
import type { RepositoryGraph } from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { ParserLanguageId } from "@/lib/languages/registry";
import type { Logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import type { SourceParser } from "@/parser";
import { SourceError, type RepositorySource, type SourceSnapshot } from "@/sources/types";
import { runConstructStage } from "./stages/construct-stage";
import { PipelineContext } from "./stages/context";
import { runDependenciesStage } from "./stages/dependencies-stage";
import { runFetchStage } from "./stages/fetch-stage";
import {
  prefetchCommitHistory,
  runHistoryStage,
  selectActivityCandidates,
} from "./stages/history-stage";
import { REPOSITORY_FOUND, languageMessage, treeMessage } from "./stages/messages";
import { runParseStage } from "./stages/parse-stage";
import { ANALYZER_VERSION } from "./version";

/**
 * The analysis pipeline: turns a `RepositorySource` into a `RepositoryGraph`,
 * streaming progress as protocol events.
 *
 *   connect → tree → languages (+ preview) → fetch → parse → dependencies
 *     → history → construct (+ complete)
 *
 * Contract:
 * - every stage emits "start", optional throttled "progress", then exactly one
 *   of "done" / "skipped" / "warning"; a structure-only "preview" graph follows
 *   the languages stage, and "complete" (with the final graph) ends a
 *   successful run;
 * - failures that make the result meaningless (repository not found, empty
 *   repository, cancellation, ...) reject with a `SourceError` and emit no
 *   terminal event; the caller reports them;
 * - per-file and optional-history failures never fail the analysis: they
 *   become honest file statuses and warnings;
 * - the abort signal is honoured everywhere; background work is cancelled
 *   when the function settles.
 *
 * Provider-agnostic: nothing here knows about GitHub.
 */

export { ANALYZER_VERSION };

export interface AnalyzeOptions {
  limits: AnalysisLimits;
  parser: SourceParser;
  emit: (event: AnalysisEvent) => void;
  logger: Logger;
  signal?: AbortSignal;
  /** Clock in epoch milliseconds (default `Date.now`); injectable for deterministic output. */
  now?: () => number;
  /** Already-resolved snapshot; when present the connect stage only reports "done". */
  snapshot?: SourceSnapshot;
}

export async function analyzeRepository(
  source: RepositorySource,
  options: AnalyzeOptions,
): Promise<RepositoryGraph> {
  // Internal controller: follows the caller's signal and cancels background
  // work (history prefetch) once the analysis settles, whatever the outcome.
  const controller = new AbortController();
  const external = options.signal;
  const forwardAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", forwardAbort, { once: true });

  const context = new PipelineContext({
    limits: options.limits,
    emit: options.emit,
    logger: options.logger,
    signal: controller.signal,
    now: options.now ?? Date.now,
  });
  try {
    return await runPipeline(source, options, context);
  } finally {
    external?.removeEventListener("abort", forwardAbort);
    controller.abort();
  }
}

async function resolveSnapshot(
  source: RepositorySource,
  options: AnalyzeOptions,
  context: PipelineContext,
): Promise<SourceSnapshot> {
  if (options.snapshot) {
    context.throwIfAborted();
    context.timings.connect = 0;
    context.emit({ type: "stage", stage: "connect", status: "done", message: REPOSITORY_FOUND });
    return options.snapshot;
  }
  const stage = context.startStage("connect");
  const snapshot = await source.getSnapshot(context.signal);
  stage.finish("done", REPOSITORY_FOUND);
  return snapshot;
}

async function runPipeline(
  source: RepositorySource,
  options: AnalyzeOptions,
  context: PipelineContext,
): Promise<RepositoryGraph> {
  const { limits, parser } = options;
  const snapshot = await resolveSnapshot(source, options, context);
  const { repository } = snapshot;

  // ── tree ──
  const treeStage = context.startStage("tree");
  const tree = await source.listTree(snapshot, context.signal);
  const inventory = buildInventory(tree);
  const rejected: unknown = (tree as { rejectedEntries?: unknown }).rejectedEntries;
  if (typeof rejected === "number" && rejected > 0) {
    context.logger.info("tree entries rejected by path sanitization", { rejected });
  }
  if (inventory.files.length === 0) {
    throw new SourceError("EMPTY_REPOSITORY", "The repository has no files to analyze.");
  }
  treeStage.finish("done", treeMessage(inventory.files.length, inventory.truncated));

  // ── languages (+ preview) ──
  const languagesStage = context.startStage("languages");
  const tier = determineTier(inventory.files.length, limits);
  const graphFiles = selectGraphFiles(inventory, limits);
  const graphInventory = inventory.files.filter((file) => graphFiles.has(file.path));
  const parserLanguages = new Set<ParserLanguageId>();
  for (const file of graphInventory)
    if (file.parserLanguage) parserLanguages.add(file.parserLanguage);
  // Grammar loading overlaps with downloads; warmup never rejects.
  void parser.warmup([...parserLanguages]).catch(() => undefined);
  const preview = buildPreviewGraph({
    repository,
    inventory,
    graphFiles,
    tier,
    limits,
    startedAt: context.startedAt,
    finishedAt: context.now(),
    analyzerVersion: ANALYZER_VERSION,
    warnings: [],
    timings: { ...context.timings },
  });
  languagesStage.finish("done", languageMessage(preview.languages));
  context.emit({ type: "preview", graph: preview });

  // Commit-level history does not need file contents: collect it while downloading.
  const prefetchedHistory = prefetchCommitHistory(context, source, snapshot);

  // ── fetch ──
  const plan = planContentFetch(inventory, graphFiles, tier, limits);
  const fetched = await runFetchStage(context, { source, snapshot, plan, graphFiles });
  recordMetric(METRIC_NAMES.fetchFailures, fetched.failedFiles + fetched.rateLimitedFiles);

  // ── parse ──
  const inventoryByPath = new Map(inventory.files.map((file) => [file.path, file] as const));
  const analyses = fetched.analyses;
  await runParseStage(context, {
    parser,
    plan,
    inventoryByPath,
    contents: fetched.contents,
    analyses,
  });

  // ── dependencies ──
  const dependencies = runDependenciesStage(context, {
    inventory,
    inventoryByPath,
    graphFiles,
    plan,
    analyses,
    contents: fetched.contents,
  });
  // Source text is not needed past this point.
  fetched.contents.clear();

  // ── history ──
  const history = await runHistoryStage(context, {
    source,
    snapshot,
    prefetched: prefetchedHistory,
    activityCandidates: selectActivityCandidates(
      graphInventory,
      analyses,
      limits.maxFileHistoryLookups,
    ),
  });

  // ── construct (+ complete) ──
  const graph = runConstructStage(
    context,
    {
      repository,
      inventory,
      graphFiles,
      tier,
      fetchPlan: plan,
      analyses,
      dependencies,
      history,
      analyzerVersion: ANALYZER_VERSION,
      bytesDownloaded: fetched.bytesDownloaded,
    },
    source.getRateLimit(),
  );
  context.logger.debug("analysis finished", {
    tier,
    files: graph.analysis.coverage.filesInGraph,
    durationMs: graph.analysis.durationMs,
  });
  return graph;
}
