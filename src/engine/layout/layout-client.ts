import { computeWorldLayout } from "./compute-layout";
import { toLayoutInput, type LayoutGraphInput } from "./layout-input";
import type { WorldLayout } from "./types";
import { isLayoutWorkerResponse, type LayoutComputeRequest } from "./worker-protocol";

/**
 * Framework-free orchestration of layout computation (used by `useLayoutEngine`).
 *
 * - Computes in a Web Worker when one can be created; one worker is reused for
 *   every request and terminated on `dispose()`.
 * - Falls back to computing on the main thread, deferred so the UI can paint
 *   first, when no worker is available, posting fails, the worker crashes or
 *   reports an error.
 * - Only the latest request counts: starting a new request settles the previous
 *   one as "stale", and late worker results for old request ids are ignored.
 * - Results are memoized per graph object, so remounting the explorer (or React
 *   StrictMode's double effects) does not recompute an unchanged graph.
 */

export type LayoutOutcome =
  | { status: "done"; layout: WorldLayout; source: "worker" | "main-thread" | "cache" }
  | { status: "error"; message: string }
  | { status: "stale" };

/** Minimal handle over a worker; decouples the client from the DOM `Worker` type. */
export interface LayoutWorkerPort {
  post(message: LayoutComputeRequest): void;
  terminate(): void;
}

export interface LayoutWorkerCallbacks {
  onMessage(data: unknown): void;
  /** The worker crashed, failed to load, or a message could not be deserialized. */
  onError(message: string): void;
}

/** Creates a worker port, or returns null when workers are unavailable. */
export type LayoutWorkerFactory = (callbacks: LayoutWorkerCallbacks) => LayoutWorkerPort | null;

/** Schedules a task; returns a function cancelling it. */
export type TaskScheduler = (task: () => void) => () => void;

export interface LayoutClientOptions {
  createWorker?: LayoutWorkerFactory | null;
  schedule?: TaskScheduler;
  compute?: (graph: LayoutGraphInput) => WorldLayout;
}

interface PendingRequest {
  requestId: number;
  graph: LayoutGraphInput;
  resolve: (outcome: LayoutOutcome) => void;
  cancelFallback: (() => void) | null;
}

const MAIN_THREAD_ERROR_PREFIX = "Could not lay out this repository";

/** Layouts memoized by graph object identity (shared by all clients). */
const layoutCache = new WeakMap<object, WorldLayout>();

/**
 * Default scheduler: waits for the next animation frame (so a pending
 * "Building the city" state can paint), then yields once more to the event loop.
 */
export const deferToNextPaint: TaskScheduler = (task) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  const run = () => {
    timeout = setTimeout(task, 0);
  };
  if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(run);
  else run();
  return () => {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    if (timeout !== null) clearTimeout(timeout);
  };
};

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown error";
}

export class LayoutClient {
  private readonly createWorker: LayoutWorkerFactory | null;
  private readonly schedule: TaskScheduler;
  private readonly computeSync: (graph: LayoutGraphInput) => WorldLayout;
  private port: LayoutWorkerPort | null = null;
  private workerUnavailable = false;
  private nextRequestId = 0;
  private pending: PendingRequest | null = null;
  private disposed = false;

  constructor(options: LayoutClientOptions = {}) {
    this.createWorker = options.createWorker ?? null;
    this.schedule = options.schedule ?? deferToNextPaint;
    this.computeSync = options.compute ?? ((graph) => computeWorldLayout(graph));
  }

  /** Computes the layout of `graph`. Resolves "stale" if superseded or disposed first. */
  compute(graph: LayoutGraphInput): Promise<LayoutOutcome> {
    this.settle(this.pending, { status: "stale" });
    if (this.disposed) return Promise.resolve({ status: "stale" });
    const cached = layoutCache.get(graph);
    if (cached) return Promise.resolve({ status: "done", layout: cached, source: "cache" });

    this.nextRequestId += 1;
    const requestId = this.nextRequestId;
    return new Promise<LayoutOutcome>((resolve) => {
      const pending: PendingRequest = { requestId, graph, resolve, cancelFallback: null };
      this.pending = pending;
      const port = this.ensurePort();
      const message = port ? this.createRequest(requestId, graph) : null;
      if (port && message) {
        try {
          port.post(message);
          return;
        } catch {
          // e.g. DataCloneError: this worker cannot be used; fall through to the main thread.
          this.discardWorker();
        }
      }
      this.runOnMainThread(pending);
    });
  }

  /** Terminates the worker and settles any pending request as "stale". */
  dispose(): void {
    this.disposed = true;
    this.settle(this.pending, { status: "stale" });
    this.discardWorker();
  }

  /** Builds the worker request; null when the graph cannot even be read (main thread reports why). */
  private createRequest(requestId: number, graph: LayoutGraphInput): LayoutComputeRequest | null {
    try {
      return { type: "compute", requestId, graph: toLayoutInput(graph) };
    } catch {
      return null;
    }
  }

  private ensurePort(): LayoutWorkerPort | null {
    if (this.port || this.workerUnavailable || !this.createWorker) return this.port;
    try {
      this.port = this.createWorker({
        onMessage: (data) => this.handleMessage(data),
        onError: () => this.handleWorkerFailure(),
      });
    } catch {
      this.port = null;
    }
    if (!this.port) this.workerUnavailable = true;
    return this.port;
  }

  private discardWorker(): void {
    const port = this.port;
    this.port = null;
    this.workerUnavailable = true;
    if (!port) return;
    try {
      port.terminate();
    } catch {
      // Terminating an already-dead worker is harmless.
    }
  }

  private handleMessage(data: unknown): void {
    if (!isLayoutWorkerResponse(data)) return;
    const pending = this.pending;
    if (!pending || pending.requestId !== data.requestId) return; // stale result
    if (data.type === "result") {
      layoutCache.set(pending.graph, data.layout);
      this.settle(pending, { status: "done", layout: data.layout, source: "worker" });
      return;
    }
    // The worker could not compute it; retry once on the main thread.
    this.runOnMainThread(pending);
  }

  private handleWorkerFailure(): void {
    this.discardWorker();
    const pending = this.pending;
    if (pending && !pending.cancelFallback) this.runOnMainThread(pending);
  }

  private runOnMainThread(pending: PendingRequest): void {
    if (pending.cancelFallback) return;
    pending.cancelFallback = this.schedule(() => {
      if (this.pending !== pending) return;
      try {
        const layout = this.computeSync(pending.graph);
        layoutCache.set(pending.graph, layout);
        this.settle(pending, { status: "done", layout, source: "main-thread" });
      } catch (error) {
        this.settle(pending, {
          status: "error",
          message: `${MAIN_THREAD_ERROR_PREFIX}: ${describeError(error)}`,
        });
      }
    });
  }

  private settle(pending: PendingRequest | null, outcome: LayoutOutcome): void {
    if (!pending) return;
    if (this.pending === pending) this.pending = null;
    if (outcome.status === "stale") pending.cancelFallback?.();
    pending.resolve(outcome);
  }
}
