import type { Cache, CacheSetOptions } from "./types";

/**
 * Read-through composition of caches, fastest first (e.g. memory, then disk).
 *
 * - `get` asks each tier in order; a hit in a slower tier is copied into the
 *   faster tiers. A failing tier counts as a miss.
 * - `set` and `delete` go to every tier. All tiers are started synchronously,
 *   so a synchronous tier (MemoryCache) is updated before `set` settles; the
 *   returned promise rejects with the first failure after every tier finished.
 */
export class TieredCache<V> implements Cache<V> {
  readonly #tiers: readonly Cache<V>[];

  constructor(tiers: readonly Cache<V>[]) {
    if (tiers.length === 0) throw new RangeError("TieredCache needs at least one tier");
    this.#tiers = [...tiers];
  }

  async get(key: string): Promise<V | undefined> {
    for (let index = 0; index < this.#tiers.length; index += 1) {
      const tier = this.#tiers[index];
      if (!tier) continue;
      let value: V | undefined;
      try {
        value = await tier.get(key);
      } catch {
        continue;
      }
      if (value === undefined) continue;
      for (const faster of this.#tiers.slice(0, index)) {
        faster.set(key, value).catch(() => undefined);
      }
      return value;
    }
    return undefined;
  }

  async set(key: string, value: V, options?: CacheSetOptions): Promise<void> {
    await settleAll(this.#tiers.map((tier) => invoke(() => tier.set(key, value, options))));
  }

  async delete(key: string): Promise<void> {
    await settleAll(this.#tiers.map((tier) => invoke(() => tier.delete(key))));
  }
}

/** Calls `operation`, turning a synchronous throw into a rejected promise. */
function invoke(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

async function settleAll(operations: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result) => result.status === "rejected");
  if (failure && failure.status === "rejected") throw failure.reason;
}
