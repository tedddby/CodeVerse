/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight, in
 * order. Before each new item, `shouldStart` is consulted; once it returns
 * false no further items start (items already running finish normally).
 *
 * Workers are expected to handle their own failures. If one throws anyway
 * (e.g. cancellation), no further items start and the pool rejects with that
 * error once the running items have settled. Resolves with the number of
 * items started, so `items.slice(started)` are the items that never ran.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStart: () => boolean = () => true,
): Promise<number> {
  const state: { next: number; failure: { error: unknown } | null } = { next: 0, failure: null };
  const lanes = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  const lane = async (): Promise<void> => {
    while (state.failure === null && state.next < items.length && shouldStart()) {
      const index = state.next;
      state.next += 1;
      try {
        await worker(items[index] as T, index);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  };

  if (items.length > 0) await Promise.all(Array.from({ length: lanes }, lane));
  if (state.failure) throw state.failure.error;
  return state.next;
}
