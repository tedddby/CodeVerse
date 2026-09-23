/**
 * Asynchronous key/value cache. Implementations are best-effort: a miss is
 * always an acceptable answer, so callers must be able to recompute any value.
 */
export interface Cache<V> {
  /** The cached value, or undefined when absent or expired. */
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CacheSetOptions {
  /** Time to live in milliseconds; the implementation's default when omitted. */
  ttlMs?: number;
  /** Approximate in-memory size of the value, when the caller already knows it. */
  sizeBytes?: number;
}
