import { SourceError } from "@/sources/types";

/**
 * Bounds how many analyses run at once in this process. Each analysis holds
 * up to `maxTotalBytes` of source text and parses on the event loop, so an
 * unbounded burst of distinct repositories would exhaust memory and CPU.
 * Excess analyses wait in FIFO order (abortable, bounded in time).
 */

/** Raised when an analysis waited too long for a free slot. */
export class AnalysisBusyError extends Error {
  constructor() {
    super("No analysis slot became available in time.");
    this.name = "AnalysisBusyError";
  }
}

interface Waiter {
  grant: () => void;
}

export class ConcurrencyGate {
  readonly #max: number;
  readonly #queue: Waiter[] = [];
  #active = 0;

  constructor(maxConcurrent: number) {
    this.#max = Math.max(1, Math.floor(Number.isFinite(maxConcurrent) ? maxConcurrent : 1));
  }

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#queue.length;
  }

  /**
   * Resolves with a `release` function once a slot is free. Rejects with
   * `SourceError("ABORTED")` when `signal` aborts while waiting, and with
   * `AnalysisBusyError` after `maxWaitMs`. `onQueued` is called once when
   * the caller has to wait.
   */
  acquire(signal: AbortSignal, maxWaitMs: number, onQueued?: () => void): Promise<() => void> {
    if (signal.aborted)
      return Promise.reject(new SourceError("ABORTED", "The analysis was cancelled."));
    if (this.#active < this.#max) {
      this.#active += 1;
      return Promise.resolve(this.#releaser());
    }
    onQueued?.();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          cleanup();
          this.#active += 1;
          resolve(this.#releaser());
        },
      };
      const leave = (error: Error) => {
        const index = this.#queue.indexOf(waiter);
        if (index !== -1) this.#queue.splice(index, 1);
        cleanup();
        reject(error);
      };
      const onAbort = () => leave(new SourceError("ABORTED", "The analysis was cancelled."));
      const timer = setTimeout(() => leave(new AnalysisBusyError()), Math.max(0, maxWaitMs));
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      const next = this.#queue.shift();
      next?.grant();
    };
  }
}
