import type { AnalysisEvent } from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";
import { SourceError } from "@/sources/types";

/**
 * Single-flight for analyses, with live fan-out.
 *
 * Concurrent requests for the same cache key share one analysis ("flight"):
 * - the first subscriber starts it; later subscribers first receive a replay
 *   of the progress so far (stage events and the preview), then live events;
 * - terminal events are never broadcast: each subscriber awaits the shared
 *   result and reports completion or failure on its own stream;
 * - a subscriber that disconnects only unsubscribes; the analysis is aborted
 *   when the last subscriber has left (so it is never cached half-done);
 * - the flight is released as soon as it settles, so later requests go
 *   through the graph cache.
 */

export type FlightRunner = (
  emit: (event: AnalysisEvent) => void,
  signal: AbortSignal,
) => Promise<RepositoryGraph>;

interface Flight {
  readonly controller: AbortController;
  /** Replayable events so far, with consecutive progress events of a stage collapsed. */
  readonly log: AnalysisEvent[];
  readonly listeners: Set<(event: AnalysisEvent) => void>;
  readonly promise: Promise<RepositoryGraph>;
  settled: boolean;
}

export interface JoinResult {
  graph: RepositoryGraph;
  /** True when this subscriber joined an analysis another request had started. */
  shared: boolean;
}

function abortError(): SourceError {
  return new SourceError("ABORTED", "The analysis was cancelled.");
}

function appendToLog(log: AnalysisEvent[], event: AnalysisEvent): void {
  const last = log[log.length - 1];
  if (
    event.type === "stage" &&
    event.status === "progress" &&
    last?.type === "stage" &&
    last.status === "progress" &&
    last.stage === event.stage
  ) {
    log[log.length - 1] = event;
    return;
  }
  log.push(event);
}

function deliver(listener: (event: AnalysisEvent) => void, event: AnalysisEvent): void {
  try {
    listener(event);
  } catch {
    // One broken consumer must not affect the others.
  }
}

export class AnalysisHub {
  readonly #flights = new Map<string, Flight>();

  /** Analyses currently running. */
  get activeFlights(): number {
    return this.#flights.size;
  }

  /**
   * Subscribes to the analysis for `key`, starting it with `run` when none is
   * in flight. Rejects with `SourceError("ABORTED")` as soon as `signal`
   * aborts, and with the analysis error when the shared analysis fails.
   */
  join(
    key: string,
    run: FlightRunner,
    emit: (event: AnalysisEvent) => void,
    signal: AbortSignal,
  ): Promise<JoinResult> {
    if (signal.aborted) return Promise.reject(abortError());
    // A flight whose last subscriber just left is being cancelled: start a fresh one.
    const current = this.#flights.get(key);
    const existing = current && !current.controller.signal.aborted ? current : undefined;
    const flight = existing ?? this.#start(key, run);
    const shared = existing !== undefined;
    // A unique function per subscription, even if callers reuse `emit`.
    const listener = (event: AnalysisEvent) => emit(event);
    if (shared) for (const event of [...flight.log]) deliver(listener, event);
    flight.listeners.add(listener);

    return new Promise<JoinResult>((resolve, reject) => {
      const leave = () => {
        signal.removeEventListener("abort", onAbort);
        flight.listeners.delete(listener);
      };
      const onAbort = () => {
        leave();
        if (!flight.settled && flight.listeners.size === 0) flight.controller.abort();
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      flight.promise.then(
        (graph) => {
          leave();
          resolve({ graph, shared });
        },
        (error: unknown) => {
          leave();
          reject(error);
        },
      );
    });
  }

  #start(key: string, run: FlightRunner): Flight {
    const controller = new AbortController();
    const log: AnalysisEvent[] = [];
    const listeners = new Set<(event: AnalysisEvent) => void>();
    const broadcast = (event: AnalysisEvent) => {
      if (event.type === "complete" || event.type === "error" || event.type === "heartbeat") return;
      appendToLog(log, event);
      for (const listener of [...listeners]) deliver(listener, event);
    };
    // Started on a microtask so the first subscriber is registered before any event.
    const promise = Promise.resolve()
      .then(() => run(broadcast, controller.signal))
      .finally(() => {
        flight.settled = true;
        if (this.#flights.get(key) === flight) this.#flights.delete(key);
      });
    const flight: Flight = { controller, log, listeners, promise, settled: false };
    // Subscribers observe the outcome; this handler only prevents an unhandled rejection
    // when every subscriber has already left.
    promise.catch(() => undefined);
    this.#flights.set(key, flight);
    return flight;
  }
}
