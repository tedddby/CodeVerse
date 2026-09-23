/**
 * Helpers for running the real pipeline (real parser, real graph builders)
 * against in-memory sources in integration tests.
 */
import { analyzeRepository, type AnalyzeOptions } from "@/analysis/pipeline";
import type { AnalysisEvent, StageEvent } from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";
import { DEFAULT_LIMITS, type AnalysisLimits } from "@/lib/config/limits";
import { silentLogger } from "@/lib/observability/logger";
import type { SourceParser } from "@/parser";
import { testParser } from "@/parser/test-helpers";
import { MemorySource, type MemorySourceSpec } from "@/sources/memory";
import type { RepositorySource } from "@/sources/types";
import { FIXED_NOW, TEST_LIMITS } from "./polyglot-repository";

export function testLimits(overrides: Partial<AnalysisLimits> = {}): AnalysisLimits {
  return { ...DEFAULT_LIMITS, ...TEST_LIMITS, ...overrides };
}

/** The shared real tree-sitter parser (grammars from public/grammars). */
export function realParser(): SourceParser {
  return testParser();
}

export interface PipelineRun {
  graph: RepositoryGraph;
  events: AnalysisEvent[];
}

export interface RunOptions {
  limits?: Partial<AnalysisLimits>;
  now?: () => number;
  signal?: AbortSignal;
  onEvent?: (event: AnalysisEvent) => void;
  parser?: SourceParser;
}

export async function runPipeline(
  source: RepositorySource,
  options: RunOptions = {},
): Promise<PipelineRun> {
  const events: AnalysisEvent[] = [];
  const analyzeOptions: AnalyzeOptions = {
    limits: testLimits(options.limits),
    parser: options.parser ?? realParser(),
    emit: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
    logger: silentLogger,
    now: options.now ?? (() => FIXED_NOW),
    signal: options.signal,
  };
  const graph = await analyzeRepository(source, analyzeOptions);
  return { graph, events };
}

export function memorySource(spec: MemorySourceSpec): MemorySource {
  return new MemorySource(spec);
}

/**
 * A source that delegates to `inner` with some methods replaced; used to
 * simulate provider failures. Capabilities and optional methods follow `inner`.
 */
export function overrideSource(
  inner: RepositorySource,
  overrides: Partial<Omit<RepositorySource, "provider" | "capabilities">>,
): RepositorySource {
  const innerFileActivity = inner.getFileActivity?.bind(inner);
  const innerCommitCounts = inner.getCommitCounts?.bind(inner);
  return {
    provider: inner.provider,
    capabilities: inner.capabilities,
    getSnapshot: overrides.getSnapshot ?? ((signal) => inner.getSnapshot(signal)),
    listTree: overrides.listTree ?? ((snapshot, signal) => inner.listTree(snapshot, signal)),
    readFile:
      overrides.readFile ?? ((snapshot, path, options) => inner.readFile(snapshot, path, options)),
    listCommits:
      overrides.listCommits ?? ((snapshot, options) => inner.listCommits(snapshot, options)),
    getCommitDetails:
      overrides.getCommitDetails ??
      ((snapshot, sha, signal) => inner.getCommitDetails(snapshot, sha, signal)),
    listContributors:
      overrides.listContributors ??
      ((snapshot, signal) => inner.listContributors(snapshot, signal)),
    getFileActivity: overrides.getFileActivity ?? innerFileActivity,
    getCommitCounts: overrides.getCommitCounts ?? innerCommitCounts,
    getRateLimit: overrides.getRateLimit ?? (() => inner.getRateLimit()),
  };
}

export function stageEvents(events: readonly AnalysisEvent[]): StageEvent[] {
  return events.filter((event): event is StageEvent => event.type === "stage");
}

/** The final status event of every stage, in order of appearance. */
export function finalStageEvents(events: readonly AnalysisEvent[]): StageEvent[] {
  return stageEvents(events).filter(
    (event) => event.status === "done" || event.status === "skipped" || event.status === "warning",
  );
}

export function fileByPath(graph: RepositoryGraph, path: string) {
  const file = graph.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Expected ${path} in the graph`);
  return file;
}

/** The graph without fields that legitimately differ between runs (timings). */
export function withoutTimings(graph: RepositoryGraph): unknown {
  const copy = structuredClone(graph);
  copy.analysis.timings = {};
  copy.analysis.durationMs = 0;
  copy.analysis.generatedAt = "";
  return copy;
}
