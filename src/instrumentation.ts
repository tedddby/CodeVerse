/**
 * Next.js instrumentation hook: runs once when a server instance starts.
 *
 * Node.js runtime only (every API route runs on Node.js). Observability
 * modules are imported lazily so the Edge bundle never includes them.
 *
 * Telemetry hook point
 * --------------------
 * CodeVerse records metrics and spans through a vendor-neutral `MetricsSink`
 * (`src/lib/observability/metrics.ts`); by default measurements are written
 * as debug log lines (`CODEVERSE_METRICS=off` drops them). To export to a
 * backend, build a sink in `createTelemetrySink` below and return it, e.g.
 * with OpenTelemetry:
 *
 *   const meter = metrics.getMeter("codeverse");
 *   const tracer = trace.getTracer("codeverse");
 *   return {
 *     recordMetric: (name, value, attributes) =>
 *       meter.createHistogram(name).record(value, attributes),
 *     startSpan: (name, attributes) => {
 *       const span = tracer.startSpan(name, { attributes });
 *       return { end: ({ error }) => { if (error) span.recordException(String(error)); span.end(); } };
 *     },
 *   };
 *
 * (and register the SDK/exporter first, e.g. `registerOTel("codeverse")`).
 * Sentry and other SDKs plug in the same way.
 */

import type { Instrumentation } from "next";
import type { MetricsSink } from "@/lib/observability/metrics";

/**
 * Returns the exporter sink to install, or undefined to use the default
 * (log-based, controlled by `CODEVERSE_METRICS`). This is the single place to
 * connect OpenTelemetry, Sentry or any other telemetry backend.
 */
function createTelemetrySink(): MetricsSink | undefined {
  return undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startServerObservability } = await import("@/lib/observability/startup");
  startServerObservability({ metricsSink: createTelemetrySink() });
}

/**
 * Logs unhandled server errors as structured, redacted records. Request
 * headers are deliberately not logged (they carry cookies and credentials).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/observability/logger");
  logger.error("unhandled request error", {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    error,
  });
};
