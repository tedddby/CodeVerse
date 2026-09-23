import { afterEach, describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "./logger";
import {
  createLogMetricsSink,
  noopMetricsSink,
  recordMetric,
  setMetricsSink,
  startTimer,
  withSpan,
  type MetricAttributes,
  type MetricsSink,
} from "./metrics";

interface Recorded {
  name: string;
  value: number;
  attributes: MetricAttributes;
}

function recordingSink(withSpans = false) {
  const metrics: Recorded[] = [];
  const spans: Array<{
    name: string;
    attributes: MetricAttributes;
    ended?: { durationMs: number; error?: unknown };
  }> = [];
  const sink: MetricsSink = {
    recordMetric(name, value, attributes) {
      metrics.push({ name, value, attributes });
    },
  };
  if (withSpans) {
    sink.startSpan = (name, attributes) => {
      const span: (typeof spans)[number] = { name, attributes };
      spans.push(span);
      return {
        end(outcome) {
          span.ended = outcome;
        },
      };
    };
  }
  return { sink, metrics, spans };
}

let previous: MetricsSink | null = null;

function install(sink: MetricsSink) {
  const replaced = setMetricsSink(sink);
  previous ??= replaced;
}

afterEach(() => {
  if (previous) setMetricsSink(previous);
  previous = null;
});

describe("metrics facade", () => {
  it("records measurements through the installed sink and drops non-finite values", () => {
    const { sink, metrics } = recordingSink();
    install(sink);
    recordMetric("codeverse.test.count", 3, { route: "analyze" });
    recordMetric("codeverse.test.count", Number.NaN);
    expect(metrics).toEqual([
      { name: "codeverse.test.count", value: 3, attributes: { route: "analyze" } },
    ]);
  });

  it("times operations once, with extra attributes", async () => {
    const { sink, metrics } = recordingSink();
    install(sink);
    const end = startTimer("codeverse.test.duration_ms", { stage: "tree" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const elapsed = end({ outcome: "ok" });
    expect(elapsed).toBeGreaterThanOrEqual(10);
    expect(end()).toBe(elapsed);
    expect(metrics).toEqual([
      {
        name: "codeverse.test.duration_ms",
        value: elapsed,
        attributes: { stage: "tree", outcome: "ok" },
      },
    ]);
  });

  it("wraps operations in spans and records their outcome", async () => {
    const { sink, metrics, spans } = recordingSink(true);
    install(sink);
    await expect(withSpan("codeverse.test.op", { kind: "ok" }, async () => 42)).resolves.toBe(42);
    const failure = new Error("nope");
    await expect(
      withSpan("codeverse.test.op", { kind: "bad" }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(metrics.map((metric) => [metric.name, metric.attributes.outcome])).toEqual([
      ["codeverse.test.op.duration_ms", "ok"],
      ["codeverse.test.op.duration_ms", "error"],
    ]);
    expect(spans[0]?.ended?.error).toBeUndefined();
    expect(spans[1]?.ended?.error).toBe(failure);
  });

  it("never lets a faulty sink break the measured operation", async () => {
    install({
      recordMetric() {
        throw new Error("exporter down");
      },
      startSpan() {
        throw new Error("tracer down");
      },
    });
    expect(() => recordMetric("x", 1)).not.toThrow();
    expect(startTimer("x")()).toBeGreaterThanOrEqual(0);
    await expect(withSpan("x", {}, async () => "fine")).resolves.toBe("fine");
  });

  it("logs measurements at the chosen level by default and drops them when disabled", () => {
    const lines: Array<{ level: LogLevel; line: string }> = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (level, line) => lines.push({ level, line }) },
    });
    install(createLogMetricsSink(logger));
    recordMetric("codeverse.test.count", 1, { result: "hit" });
    install(createLogMetricsSink(logger, "info"));
    recordMetric("codeverse.test.count", 2);
    install(noopMetricsSink);
    recordMetric("codeverse.test.count", 3);
    expect(lines.map((entry) => entry.level)).toEqual(["debug", "info"]);
    expect(JSON.parse(lines[0]?.line ?? "{}")).toMatchObject({
      msg: "metric",
      metric: "codeverse.test.count",
      value: 1,
      result: "hit",
    });
  });
});
