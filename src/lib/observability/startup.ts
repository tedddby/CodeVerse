import { ANALYZER_VERSION } from "@/analysis/version";
import { describeGraphCacheConfig, readGraphCacheConfig } from "@/lib/cache/graph-cache";
import { loadLimits, snapshotLimits } from "@/lib/config/limits";
import { readAnalysesPerMinute } from "@/lib/rate-limit/limiters";
import { logger as defaultLogger, parseLogLevel, type Logger } from "./logger";
import { createLogMetricsSink, noopMetricsSink, setMetricsSink, type MetricsSink } from "./metrics";
import { APP_VERSION, isGitHubTokenConfigured } from "./runtime-info";

/**
 * Server startup: telemetry wiring and one configuration summary log line.
 * Called from `register()` in `src/instrumentation.ts` (Node.js runtime only).
 */

type Env = Record<string, string | undefined>;

/**
 * Chooses the metrics sink from `CODEVERSE_METRICS`:
 * - "log" (default): measurements are logged at debug level;
 * - "info": measurements are logged at info level (for log-based metrics
 *   pipelines such as CloudWatch, Datadog or Loki);
 * - "off": measurements are dropped.
 *
 * Exporters (OpenTelemetry, Sentry, StatsD, ...) are installed by passing
 * their own `MetricsSink` to `startServerObservability` from
 * `src/instrumentation.ts`, which takes precedence over this setting.
 */
export function metricsSinkFromEnv(env: Env, log: Logger): MetricsSink {
  const mode = env.CODEVERSE_METRICS?.trim().toLowerCase();
  if (mode === "off" || mode === "none") return noopMetricsSink;
  return createLogMetricsSink(log, mode === "info" ? "info" : "debug");
}

/** Everything operators need to confirm the configuration, and nothing secret. */
export function configurationSummary(env: Env = process.env): Record<string, unknown> {
  const cache = readGraphCacheConfig(env);
  const perMinute = readAnalysesPerMinute(env);
  return {
    version: APP_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    node: typeof process !== "undefined" ? process.version : undefined,
    githubTokenConfigured: isGitHubTokenConfigured(env) ? "yes" : "no",
    limits: snapshotLimits(loadLimits(env)),
    cacheMode: describeGraphCacheConfig(cache),
    rateLimitPerMinute: perMinute > 0 ? perMinute : "disabled",
    logLevel: parseLogLevel(env.CODEVERSE_LOG_LEVEL),
  };
}

export interface StartupOptions {
  env?: Env;
  logger?: Logger;
  /** Exporter to install instead of the environment-selected sink. */
  metricsSink?: MetricsSink;
}

export function startServerObservability(options: StartupOptions = {}): void {
  const env = options.env ?? process.env;
  const log = options.logger ?? defaultLogger;
  setMetricsSink(options.metricsSink ?? metricsSinkFromEnv(env, log));
  log.info("codeverse server starting", configurationSummary(env));
}
