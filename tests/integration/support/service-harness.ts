/**
 * Test harness for the analysis service: in-memory sources with call
 * counters, in-memory caches, the real parser and a fixed clock.
 */
import {
  createAnalysisService,
  type AnalysisRequest,
  type AnalysisServiceDeps,
} from "@/analysis/analysis-service";
import type { AnalysisEvent } from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";
import { MemoryCache } from "@/lib/cache/memory-cache";
import type { Cache } from "@/lib/cache/types";
import { silentLogger } from "@/lib/observability/logger";
import type { RepositorySource } from "@/sources/types";
import { memorySource, overrideSource, realParser, testLimits } from "./harness";
import { FIXED_NOW, polyglotSpec } from "./polyglot-repository";

export const REQUEST: AnalysisRequest = { owner: "acme", repo: "polyglot" };

export interface Counters {
  listTree: number;
  readFile: number;
  createSource: number;
}

function countingSource(inner: RepositorySource, counters: Counters): RepositorySource {
  return overrideSource(inner, {
    listTree: (snapshot, signal) => {
      counters.listTree += 1;
      return inner.listTree(snapshot, signal);
    },
    readFile: (snapshot, filePath, options) => {
      counters.readFile += 1;
      return inner.readFile(snapshot, filePath, options);
    },
  });
}

export interface Harness {
  service: ReturnType<typeof createAnalysisService>;
  counters: Counters;
  cache: Cache<RepositoryGraph>;
}

export function createHarness(
  options: {
    source?: (request: AnalysisRequest) => RepositorySource;
    deps?: Partial<AnalysisServiceDeps>;
  } = {},
): Harness {
  const counters: Counters = { listTree: 0, readFile: 0, createSource: 0 };
  const cache =
    options.deps?.cache ?? new MemoryCache<RepositoryGraph>({ maxBytes: 256 * 1024 * 1024 });
  const service = createAnalysisService({
    createSource: (request) => {
      counters.createSource += 1;
      const inner = options.source?.(request) ?? memorySource(polyglotSpec());
      return countingSource(inner, counters);
    },
    getParser: realParser,
    getLimits: () => testLimits(),
    cache,
    pointers: new MemoryCache<string>({ maxBytes: 1024 * 1024 }),
    logger: silentLogger,
    now: () => FIXED_NOW,
    ...options.deps,
  });
  return { service, counters, cache };
}

export async function collect(
  harness: Harness,
  request: AnalysisRequest = REQUEST,
  signal: AbortSignal = new AbortController().signal,
  onEvent?: (event: AnalysisEvent) => void,
): Promise<AnalysisEvent[]> {
  const events: AnalysisEvent[] = [];
  await harness.service.streamAnalysis(
    request,
    (event) => {
      events.push(event);
      onEvent?.(event);
    },
    signal,
  );
  return events;
}

export function terminalEvents(events: AnalysisEvent[]) {
  return events.filter((event) => event.type === "complete" || event.type === "error");
}

export function completedGraph(events: AnalysisEvent[]): RepositoryGraph {
  const last = events[events.length - 1];
  if (last?.type !== "complete") throw new Error(`expected complete, got ${JSON.stringify(last)}`);
  return last.graph;
}

export function errorOf(events: AnalysisEvent[]) {
  const last = events[events.length - 1];
  if (last?.type !== "error") throw new Error(`expected error, got ${last?.type}`);
  return last.error;
}
