/**
 * Request coalescing: concurrent calls with the same key share one execution
 * of `fn`. The key is released as soon as the shared promise settles, so a
 * later call starts a fresh execution (results are not cached; pair with a
 * `Cache` for that).
 *
 * The registry is process-wide (kept on `globalThis` so development hot
 * reloads keep coalescing). Keys must be namespaced by the kind of result,
 * e.g. "source:" + ..., because callers of one key share one promise type.
 */

const REGISTRY_KEY = Symbol.for("codeverse.cache.singleFlight");

type RegistryHolder = { [REGISTRY_KEY]?: Map<string, Promise<unknown>> };

function registry(): Map<string, Promise<unknown>> {
  const holder = globalThis as typeof globalThis & RegistryHolder;
  let flights = holder[REGISTRY_KEY];
  if (!flights) {
    flights = new Map();
    holder[REGISTRY_KEY] = flights;
  }
  return flights;
}

export function singleFlight<V>(key: string, fn: () => Promise<V>): Promise<V> {
  const flights = registry();
  const existing = flights.get(key);
  if (existing) return existing as Promise<V>;

  let started: Promise<V>;
  try {
    started = Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
  const shared: Promise<V> = started.finally(() => {
    if (flights.get(key) === shared) flights.delete(key);
  });
  flights.set(key, shared);
  return shared;
}

/** Number of executions currently in flight (diagnostics and tests). */
export function inFlightCount(): number {
  return registry().size;
}
