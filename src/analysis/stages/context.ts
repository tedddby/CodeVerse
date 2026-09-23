import type { AnalysisEvent, AnalysisStageId, StageEvent } from "@/analysis/protocol";
import type { AnalysisWarning } from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { Logger } from "@/lib/observability/logger";
import { METRIC_NAMES, recordMetric, startTimer } from "@/lib/observability/metrics";
import { SourceError, isSourceError } from "@/sources/types";

/**
 * Per-analysis state shared by the pipeline stages: event emission, stage
 * timings, the time budget, warnings and cancellation.
 */

/** Minimum interval between two progress events of one stage (at most 8 per second). */
export const PROGRESS_INTERVAL_MS = 125;

/** Fractions of `analysisBudgetMs` after which a stage stops starting new work. */
export const BUDGET_FRACTIONS = {
  /** No new downloads after this share of the budget. */
  fetch: 0.6,
  /** No new parses after this share of the budget. */
  parse: 0.8,
  /** Optional history steps are skipped after this share of the budget. */
  history: 0.9,
} as const;

export interface PipelineContextOptions {
  limits: AnalysisLimits;
  emit: (event: AnalysisEvent) => void;
  logger: Logger;
  signal?: AbortSignal;
  now: () => number;
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Error thrown when the analysis is cancelled through its signal. */
export function abortError(): SourceError {
  return new SourceError("ABORTED", "The analysis was cancelled.");
}

export function isAbortError(error: unknown): boolean {
  return isSourceError(error) && error.code === "ABORTED";
}

/** One running stage: throttled progress, then exactly one final status. */
export class StageRun {
  readonly #context: PipelineContext;
  readonly #stage: AnalysisStageId;
  readonly #startedAt: number;
  readonly #endTimer: () => number;
  #lastProgressAt = Number.NEGATIVE_INFINITY;
  #finished = false;

  constructor(context: PipelineContext, stage: AnalysisStageId) {
    this.#context = context;
    this.#stage = stage;
    this.#startedAt = context.now();
    this.#endTimer = startTimer(METRIC_NAMES.stageDuration, { stage });
  }

  get stage(): AnalysisStageId {
    return this.#stage;
  }

  /** Emits a progress event unless one was emitted less than 125 ms ago (the last one always passes). */
  progress(done: number, total: number, message?: string): void {
    if (this.#finished || total <= 0) return;
    const time = monotonicNow();
    if (done < total && time - this.#lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.#lastProgressAt = time;
    const event: StageEvent = {
      type: "stage",
      stage: this.#stage,
      status: "progress",
      progress: Math.min(1, Math.max(0, done / total)),
    };
    if (message) event.message = message;
    this.#context.emit(event);
  }

  /** Ends the stage, recording its duration. Later calls are ignored. */
  finish(status: "done" | "skipped" | "warning", message?: string): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#context.timings[this.#stage] = Math.max(0, this.#context.now() - this.#startedAt);
    const wallMs = this.#endTimer();
    this.#context.logger.debug("stage finished", { stage: this.#stage, status, wallMs, message });
    const event: StageEvent = { type: "stage", stage: this.#stage, status };
    if (message) event.message = message;
    this.#context.emit(event);
  }
}

export class PipelineContext {
  readonly limits: AnalysisLimits;
  readonly logger: Logger;
  readonly signal: AbortSignal | undefined;
  readonly now: () => number;
  /** Epoch milliseconds when the analysis started. */
  readonly startedAt: number;
  /** Stage durations in milliseconds (from the injected clock). */
  readonly timings: Record<string, number> = {};
  /** Warnings raised by the pipeline (they win over derived warnings with the same code). */
  readonly warnings: AnalysisWarning[] = [];
  readonly #emit: (event: AnalysisEvent) => void;

  constructor(options: PipelineContextOptions) {
    this.limits = options.limits;
    this.logger = options.logger;
    this.signal = options.signal;
    this.now = options.now;
    this.startedAt = options.now();
    this.#emit = options.emit;
  }

  /** Emits an event. A throwing consumer is logged and never breaks the analysis. */
  emit(event: AnalysisEvent): void {
    try {
      this.#emit(event);
    } catch (error) {
      this.logger.warn("analysis event consumer failed", { error, eventType: event.type });
    }
  }

  /** Emits the stage's "start" event and returns a handle to report progress and finish it. */
  startStage(stage: AnalysisStageId, message?: string): StageRun {
    this.throwIfAborted();
    const event: StageEvent = { type: "stage", stage, status: "start" };
    if (message) event.message = message;
    this.emit(event);
    return new StageRun(this, stage);
  }

  get aborted(): boolean {
    return this.signal?.aborted === true;
  }

  throwIfAborted(): void {
    if (this.aborted) throw abortError();
  }

  /** Adds a warning, replacing an earlier one with the same code. */
  addWarning(warning: AnalysisWarning): void {
    const index = this.warnings.findIndex((existing) => existing.code === warning.code);
    if (index === -1) this.warnings.push(warning);
    else this.warnings[index] = warning;
  }

  elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  /** Whether more than `fraction` of the analysis time budget has been used. */
  budgetExceeded(fraction: number): boolean {
    const budget = this.limits.analysisBudgetMs;
    return Number.isFinite(budget) && budget > 0 && this.elapsedMs() >= budget * fraction;
  }

  /** Records a failed provider call as a metric (never includes messages). */
  recordSourceFailure(error: unknown, operation: string): void {
    if (!isSourceError(error) || error.code === "ABORTED") return;
    recordMetric(METRIC_NAMES.apiError, 1, {
      code: error.code,
      status: error.status ?? 0,
      operation,
    });
  }
}

/** Resolves on the next macrotask, letting I/O callbacks (and the response stream) run. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

export { monotonicNow };
