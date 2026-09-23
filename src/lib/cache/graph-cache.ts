import path from "node:path";
import { GRAPH_SCHEMA_VERSION, type RepositoryGraph } from "@/graph/model/types";
import { logger } from "@/lib/observability/logger";
import { FileSystemCache } from "./file-system-cache";
import { MemoryCache } from "./memory-cache";
import { TieredCache } from "./tiered-cache";
import type { Cache } from "./types";

/**
 * Process-wide caches for analysed repository graphs.
 *
 * - Memory tier: LRU bounded by `CODEVERSE_CACHE_MAX_MB` (default 256 MB).
 * - Disk tier (optional): gzip records under `CODEVERSE_CACHE_DIR/graphs`.
 *   Graphs contain structure, symbols and metadata only — never source code.
 * - A small companion cache (`CODEVERSE_CACHE_DIR/latest`) maps a repository
 *   to the key of its most recently served graph, for `peekCachedGraph`.
 *
 * Both singletons live on `globalThis` so development hot reloads keep them.
 */

export const DEFAULT_CACHE_MAX_MB = 256;
/** Graphs are keyed by commit SHA; the TTL only bounds staleness of metadata such as stars. */
export const GRAPH_MEMORY_TTL_MS = 6 * 60 * 60_000;
export const GRAPH_DISK_TTL_MS = 7 * 24 * 60 * 60_000;
const POINTER_MEMORY_BYTES = 8 * 1024 * 1024;

export interface GraphCacheConfig {
  memoryMaxBytes: number;
  /** Absolute directory of the disk tier, or null when disabled. */
  directory: string | null;
}

type Env = Record<string, string | undefined>;

/** Reads the cache configuration from the environment (invalid sizes fall back to the default). */
export function readGraphCacheConfig(env: Env = process.env): GraphCacheConfig {
  const rawMb = env.CODEVERSE_CACHE_MAX_MB?.trim();
  let megabytes = DEFAULT_CACHE_MAX_MB;
  if (rawMb) {
    const parsed = Number(rawMb);
    if (Number.isFinite(parsed) && parsed >= 0) megabytes = parsed;
    else logger.warn("ignoring invalid CODEVERSE_CACHE_MAX_MB", { value: rawMb });
  }
  const directory = env.CODEVERSE_CACHE_DIR?.trim();
  return {
    memoryMaxBytes: Math.floor(megabytes * 1024 * 1024),
    directory: directory ? path.resolve(directory) : null,
  };
}

/** Human-readable cache mode for the startup log, e.g. "memory (256 MB) + disk". */
export function describeGraphCacheConfig(config: GraphCacheConfig): string {
  const memory = `memory (${Math.round(config.memoryMaxBytes / (1024 * 1024))} MB)`;
  return config.directory ? `${memory} + disk` : memory;
}

/** Cheap structural check for graphs read back from disk (the file may be foreign or tampered). */
export function isStoredGraph(value: unknown): value is RepositoryGraph {
  if (typeof value !== "object" || value === null) return false;
  const graph = value as Record<string, unknown>;
  const repository = graph.repository as Record<string, unknown> | undefined;
  return (
    graph.schemaVersion === GRAPH_SCHEMA_VERSION &&
    typeof repository === "object" &&
    repository !== null &&
    typeof repository.id === "string" &&
    typeof repository.commitSha === "string" &&
    typeof graph.rootDirectoryId === "string" &&
    [
      "directories",
      "files",
      "symbols",
      "dependencies",
      "externalPackages",
      "commits",
      "contributors",
      "languages",
    ].every((key) => Array.isArray(graph[key])) &&
    typeof graph.timeline === "object" &&
    graph.timeline !== null &&
    typeof graph.analysis === "object" &&
    graph.analysis !== null
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Builds the graph cache for a configuration (exported for tests and custom wiring). */
export function createGraphCache(config: GraphCacheConfig): Cache<RepositoryGraph> {
  const memory = new MemoryCache<RepositoryGraph>({
    maxBytes: config.memoryMaxBytes,
    defaultTtlMs: GRAPH_MEMORY_TTL_MS,
  });
  if (!config.directory) return memory;
  const disk = new FileSystemCache<RepositoryGraph>({
    directory: path.join(config.directory, "graphs"),
    defaultTtlMs: GRAPH_DISK_TTL_MS,
    validate: isStoredGraph,
    logger,
  });
  return new TieredCache([memory, disk]);
}

/** Builds the "latest graph key per repository" cache for a configuration. */
export function createGraphPointerCache(config: GraphCacheConfig): Cache<string> {
  const memory = new MemoryCache<string>({
    maxBytes: POINTER_MEMORY_BYTES,
    defaultTtlMs: GRAPH_MEMORY_TTL_MS,
  });
  if (!config.directory) return memory;
  const disk = new FileSystemCache<string>({
    directory: path.join(config.directory, "latest"),
    defaultTtlMs: GRAPH_DISK_TTL_MS,
    validate: isString,
    maxBytes: 64 * 1024 * 1024,
    logger,
  });
  return new TieredCache([memory, disk]);
}

const GRAPH_CACHE_KEY = Symbol.for("codeverse.cache.graphs");
const POINTER_CACHE_KEY = Symbol.for("codeverse.cache.graphPointers");

type Holder = {
  [GRAPH_CACHE_KEY]?: Cache<RepositoryGraph>;
  [POINTER_CACHE_KEY]?: Cache<string>;
};

/** The process-wide graph cache (memory, plus disk when `CODEVERSE_CACHE_DIR` is set). */
export function getGraphCache(): Cache<RepositoryGraph> {
  const holder = globalThis as typeof globalThis & Holder;
  holder[GRAPH_CACHE_KEY] ??= createGraphCache(readGraphCacheConfig());
  return holder[GRAPH_CACHE_KEY];
}

/** The process-wide "latest graph key per repository" cache. */
export function getGraphPointerCache(): Cache<string> {
  const holder = globalThis as typeof globalThis & Holder;
  holder[POINTER_CACHE_KEY] ??= createGraphPointerCache(readGraphCacheConfig());
  return holder[POINTER_CACHE_KEY];
}
