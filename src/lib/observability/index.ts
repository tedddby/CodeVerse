/**
 * Observability: structured logging with secret redaction, and a pluggable
 * metrics/tracing facade (see `metrics.ts` for exporter integration).
 */
export {
  createLogger,
  logger,
  parseLogLevel,
  processSink,
  silentLogger,
  type LogFields,
  type LogLevel,
  type LogSink,
  type LogThreshold,
  type Logger,
  type LoggerOptions,
} from "./logger";
export {
  METRIC_NAMES,
  createLogMetricsSink,
  noopMetricsSink,
  recordMetric,
  setMetricsSink,
  startTimer,
  withSpan,
  type MetricAttributes,
  type MetricsSink,
  type SpanHandle,
  type TimerEnd,
} from "./metrics";
export { REDACTED, isSensitiveKey, redactSecrets, redactString, registerSecret } from "./redact";
