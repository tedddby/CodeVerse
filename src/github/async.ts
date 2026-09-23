import { abortedError } from "./errors";

/** Abort-aware delay. Rejects with `SourceError("ABORTED")` when the signal fires. */
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Throws `SourceError("ABORTED")` when the signal is already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError();
}

/**
 * Resolves with `promise` unless `signal` aborts first. The underlying work is
 * not cancelled, which is what shared (de-duplicated) loads need: one caller
 * giving up must not fail the others.
 */
export function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Maps `items` with at most `concurrency` calls in flight, preserving order.
 * The first rejection rejects the whole call; tasks that have not started yet
 * are not started.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

/** Splits `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    chunks.push(items.slice(start, start + size));
  return chunks;
}
