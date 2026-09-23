/**
 * Server-side caching: a generic `Cache` interface with memory (LRU by bytes +
 * TTL), filesystem (gzip records, atomic writes) and tiered implementations,
 * request coalescing, and the process-wide graph caches.
 */
export type { Cache, CacheSetOptions } from "./types";
export { MemoryCache, type MemoryCacheOptions } from "./memory-cache";
export { FileSystemCache, type FileSystemCacheOptions } from "./file-system-cache";
export { TieredCache } from "./tiered-cache";
export { singleFlight, inFlightCount } from "./single-flight";
export { approximateSizeOf } from "./size";
export {
  createGraphCache,
  createGraphPointerCache,
  describeGraphCacheConfig,
  getGraphCache,
  getGraphPointerCache,
  isStoredGraph,
  readGraphCacheConfig,
  type GraphCacheConfig,
} from "./graph-cache";
