import { approximateSizeOf } from "./size";
import type { Cache, CacheSetOptions } from "./types";

/**
 * In-process LRU cache bounded by approximate bytes (and entry count), with
 * per-entry TTLs. Values are stored by reference: callers must treat cached
 * values as immutable.
 *
 * `set` stores the entry synchronously (before its promise settles), so a
 * value is visible to `get` as soon as `set` has been called.
 */

export interface MemoryCacheOptions<V> {
  /** Upper bound for the sum of entry sizes. Entries larger than this are not cached. */
  maxBytes: number;
  /** Default time to live; entries never expire when omitted. */
  defaultTtlMs?: number;
  /** Upper bound for the number of entries (default 10,000). */
  maxEntries?: number;
  /** Size estimate for values stored without `sizeBytes` (default `approximateSizeOf`). */
  sizeOf?: (value: V) => number;
  /** Clock (epoch milliseconds), injectable for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  sizeBytes: number;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export class MemoryCache<V> implements Cache<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #defaultTtlMs: number;
  readonly #sizeOf: (value: V) => number;
  readonly #now: () => number;
  #totalBytes = 0;

  constructor(options: MemoryCacheOptions<V>) {
    this.#maxBytes = Math.max(0, Number.isFinite(options.maxBytes) ? options.maxBytes : 0);
    this.#maxEntries = Math.floor(positiveOr(options.maxEntries, DEFAULT_MAX_ENTRIES));
    this.#defaultTtlMs = positiveOr(options.defaultTtlMs, Number.POSITIVE_INFINITY);
    this.#sizeOf = options.sizeOf ?? approximateSizeOf;
    this.#now = options.now ?? Date.now;
  }

  /** Number of live (possibly expired, not yet collected) entries. */
  get size(): number {
    return this.#entries.size;
  }

  /** Sum of the sizes of stored entries. */
  get totalBytes(): number {
    return this.#totalBytes;
  }

  get maxBytes(): number {
    return this.#maxBytes;
  }

  get(key: string): Promise<V | undefined> {
    const entry = this.#entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.#now()) {
      this.#remove(key);
      return Promise.resolve(undefined);
    }
    // Re-insert to mark as most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: V, options: CacheSetOptions = {}): Promise<void> {
    this.#remove(key);
    const sizeBytes = this.#measure(value, options.sizeBytes);
    const ttlMs = positiveOr(options.ttlMs, this.#defaultTtlMs);
    if (sizeBytes > this.#maxBytes) return Promise.resolve();
    this.#entries.set(key, { value, sizeBytes, expiresAt: this.#now() + ttlMs });
    this.#totalBytes += sizeBytes;
    this.#evict();
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#remove(key);
    return Promise.resolve();
  }

  /** Removes every entry. */
  clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  #measure(value: V, provided: number | undefined): number {
    if (provided !== undefined && Number.isFinite(provided) && provided >= 0) return provided;
    try {
      const measured = this.#sizeOf(value);
      return Number.isFinite(measured) && measured >= 0 ? measured : Number.POSITIVE_INFINITY;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#totalBytes -= entry.sizeBytes;
  }

  #evict(): void {
    // Expired entries go first, then the least recently used ones.
    if (this.#totalBytes > this.#maxBytes || this.#entries.size > this.#maxEntries) {
      const now = this.#now();
      for (const [key, entry] of this.#entries) if (entry.expiresAt <= now) this.#remove(key);
    }
    while (this.#totalBytes > this.#maxBytes || this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#remove(oldest.value);
    }
  }
}
