/**
 * Small, dependency-free caches used by the GitHub layer.
 *
 * `LruCache` bounds memory by entry count and (optionally) by a total weight,
 * e.g. the character count of cached response bodies. `ExpiringCache` adds
 * per-entry TTLs and de-duplicates concurrent loads of the same key.
 */

export interface LruCacheOptions<V> {
  maxEntries: number;
  /** Upper bound for the sum of `weigh(value)` over all entries. */
  maxWeight?: number;
  weigh?: (value: V) => number;
}

export class LruCache<K, V> {
  readonly #entries = new Map<K, { value: V; weight: number }>();
  readonly #maxEntries: number;
  readonly #maxWeight: number;
  readonly #weigh: (value: V) => number;
  #totalWeight = 0;

  constructor(options: LruCacheOptions<V>) {
    this.#maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.#maxWeight = options.maxWeight ?? Number.POSITIVE_INFINITY;
    this.#weigh = options.weigh ?? (() => 0);
  }

  get size(): number {
    return this.#entries.size;
  }

  get totalWeight(): number {
    return this.#totalWeight;
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    // Re-insert to mark as most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  /** Stores a value. Values heavier than the whole budget are not cached. */
  set(key: K, value: V): void {
    this.delete(key);
    const weight = this.#weigh(value);
    if (weight > this.#maxWeight) return;
    this.#entries.set(key, { value, weight });
    this.#totalWeight += weight;
    this.#evict();
  }

  delete(key: K): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#totalWeight -= entry.weight;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#totalWeight = 0;
  }

  #evict(): void {
    while (this.#entries.size > this.#maxEntries || this.#totalWeight > this.#maxWeight) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) return;
      this.delete(oldest.value);
    }
  }
}

export interface ExpiringCacheOptions {
  maxEntries: number;
  now?: () => number;
}

interface ExpiringEntry<V> {
  expiresAt: number;
  promise: Promise<V>;
}

/**
 * Promise cache with per-entry TTL and in-flight de-duplication: concurrent
 * `load` calls for the same key share one upstream request. Rejections are
 * evicted immediately unless `errorTtlMs` returns a positive TTL for them
 * (negative caching of definitive failures such as "not found").
 */
export class ExpiringCache<V> {
  readonly #entries: LruCache<string, ExpiringEntry<V>>;
  readonly #now: () => number;

  constructor(options: ExpiringCacheOptions) {
    this.#entries = new LruCache({ maxEntries: options.maxEntries });
    this.#now = options.now ?? Date.now;
  }

  load(
    key: string,
    ttlMs: number,
    loader: () => Promise<V>,
    errorTtlMs: (error: unknown) => number = () => 0,
  ): Promise<V> {
    const existing = this.#entries.get(key);
    if (existing && existing.expiresAt > this.#now()) return existing.promise;

    const promise = loader();
    // In-flight entries never expire; the TTL starts once the load settles.
    const entry: ExpiringEntry<V> = { expiresAt: Number.POSITIVE_INFINITY, promise };
    this.#entries.set(key, entry);
    promise.then(
      () => {
        if (this.#peek(key) === entry) entry.expiresAt = this.#now() + ttlMs;
      },
      (error: unknown) => {
        const errorTtl = errorTtlMs(error);
        if (this.#peek(key) !== entry) return;
        if (errorTtl > 0) entry.expiresAt = this.#now() + errorTtl;
        else this.#entries.delete(key);
      },
    );
    return promise;
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  #peek(key: string): ExpiringEntry<V> | undefined {
    // `get` refreshes recency, which is fine for an entry that just settled.
    return this.#entries.get(key);
  }
}
