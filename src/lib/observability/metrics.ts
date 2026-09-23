import { logger as defaultLogger, type Logger } from "./logger";

/**
 * Minimal, vendor-neutral metrics and tracing facade.
 *
 * Application code records measurements through `recordMetric`, `startTimer`
 * and `withSpan`; where they go is decided by the installed `MetricsSink`.
 * The default sink writes each measurement as a debug log line. To export to
 * OpenTelemetry, Sentry or any other backend, install a sink with
 * `setMetricsSink` at startup (see `src/instrumentation.ts`): `recordMetric`
 * maps onto histogram/counter instruments and `startSpan` onto tracer spans.
 *
 * Sinks must be cheap and non-blocking. A throwing sink never breaks the
 * operation being measured.
 */

export type MetricAttributes = Record<string, string | number | boolean>;

/** A span opened by a sink for one `withSpan` call. */
export interface SpanHandle {
  end(outcome: { durationMs: number; error?: unknown }): void;
}

export interface MetricsSink {
  /**
   * One measurement. Names ending in `.duration_ms` are durations in
   * milliseconds; other names are counts or gauges (see `METRIC_NAMES`).
   */
  recordMetric(name: string, value: number, attributes: MetricAttributes): void;
  /** Optional tracing hook, called when a `withSpan` operation starts. */
  startSpan?(name: string, attributes: MetricAttributes): SpanHandle;
}

/** Every metric CodeVerse records, for dashboards and exporters. */
export const METRIC_NAMES = {
  /** Wall time of one analysis request (cache hits included). Attributes: cached, tier, outcome. */
  analysisDuration: "codeverse.analysis.duration_ms",
  /** Wall time of one pipeline stage. Attributes: stage. */
  stageDuration: "codeverse.analysis.stage.duration_ms",
  /** Graph assembly time (part of the "construct" stage). */
  graphBuildDuration: "codeverse.analysis.graph_build.duration_ms",
  /** Files included in the graph / analysed per analysis. */
  filesInGraph: "codeverse.analysis.files_in_graph",
  filesParsed: "codeverse.analysis.files_parsed",
  parseFailures: "codeverse.analysis.parse_failures",
  fetchFailures: "codeverse.analysis.fetch_failures",
  bytesDownloaded: "codeverse.analysis.bytes_downloaded",
  /** Graph cache lookups. Attributes: result (hit | miss). */
  cacheLookup: "codeverse.cache.lookup",
  /** Upstream provider failures. Attributes: code, status, operation. */
  apiError: "codeverse.github.api_error",
  /** Remaining provider quota observed at the end of an analysis. Attributes: authenticated. */
  rateLimitRemaining: "codeverse.github.rate_limit_remaining",
  /** Requests rejected by the per-client rate limiter. Attributes: route. */
  clientRateLimited: "codeverse.http.client_rate_limited",
} as const;

function logSink(log: Logger, level: "debug" | "info" = "debug"): MetricsSink {
  return {
    recordMetric(name, value, attributes) {
      log[level]("metric", { metric: name, value, ...attributes });
    },
  };
}

let activeSink: MetricsSink = logSink(defaultLogger);

/** Installs the sink that receives every measurement; returns the previous one. */
export function setMetricsSink(sink: MetricsSink): MetricsSink {
  const previous = activeSink;
  activeSink = sink;
  return previous;
}

/** A sink that writes each measurement as a log line (debug level by default). */
export function createLogMetricsSink(
  log: Logger = defaultLogger,
  level: "debug" | "info" = "debug",
): MetricsSink {
  return logSink(log, level);
}

/** A sink that drops everything. */
export const noopMetricsSink: MetricsSink = { recordMetric() {} };

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Records one measurement. Non-finite values are dropped. */
export function recordMetric(name: string, value: number, attributes: MetricAttributes = {}): void {
  if (!Number.isFinite(value)) return;
  try {
    activeSink.recordMetric(name, value, attributes);
  } catch {
    // A faulty exporter must never break the measured operation.
  }
}

/** Stops a timer, records `name` with the elapsed milliseconds and returns them. */
export type TimerEnd = (extraAttributes?: MetricAttributes) => number;

/**
 * Starts a monotonic timer. Calling the returned function records the elapsed
 * time under `name` and returns it; later calls return the first result
 * without recording again.
 */
export function startTimer(name: string, attributes: MetricAttributes = {}): TimerEnd {
  const startedAt = monotonicNow();
  let result: number | undefined;
  return (extraAttributes) => {
    if (result !== undefined) return result;
    result = roundMs(monotonicNow() - startedAt);
    recordMetric(
      name,
      result,
      extraAttributes ? { ...attributes, ...extraAttributes } : attributes,
    );
    return result;
  };
}

/**
 * Runs `operation` inside a span: the sink's `startSpan` (when present) is
 * opened before and closed after, and `<name>.duration_ms` is recorded with an
 * `outcome` attribute of "ok" or "error". Errors are rethrown unchanged.
 */
export async function withSpan<T>(
  name: string,
  attributes: MetricAttributes,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = monotonicNow();
  let span: SpanHandle | undefined;
  try {
    span = activeSink.startSpan?.(name, attributes);
  } catch {
    span = undefined;
  }
  const finish = (error?: unknown) => {
    const durationMs = roundMs(monotonicNow() - startedAt);
    recordMetric(`${name}.duration_ms`, durationMs, {
      ...attributes,
      outcome: error === undefined ? "ok" : "error",
    });
    try {
      span?.end(error === undefined ? { durationMs } : { durationMs, error });
    } catch {
      // Ignore exporter failures.
    }
  };
  try {
    const result = await operation();
    finish();
    return result;
  } catch (error) {
    finish(error ?? new Error("Operation failed"));
    throw error;
  }
}
