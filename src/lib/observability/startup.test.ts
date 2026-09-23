import { afterEach, describe, expect, it } from "vitest";
import { ANALYZER_VERSION } from "@/analysis/version";
import { createLogger, type LogSink } from "./logger";
import { noopMetricsSink, recordMetric, setMetricsSink, type MetricsSink } from "./metrics";
import { configurationSummary, metricsSinkFromEnv, startServerObservability } from "./startup";

const TOKEN = "ghp_StartupSecretToken0123456789abcdefAB";

let restore: MetricsSink | null = null;

afterEach(() => {
  if (restore) setMetricsSink(restore);
  restore = null;
});

function capture() {
  const lines: string[] = [];
  const sink: LogSink = { write: (_level, line) => lines.push(line) };
  return { lines, logger: createLogger({ sink, level: "debug" }) };
}

describe("configurationSummary", () => {
  it("summarizes the configuration without exposing the token", () => {
    const summary = configurationSummary({
      GITHUB_TOKEN: TOKEN,
      CODEVERSE_CACHE_DIR: ".cache",
      CODEVERSE_CACHE_MAX_MB: "128",
      CODEVERSE_RATE_LIMIT_PER_MINUTE: "0",
      CODEVERSE_MAX_PARSED_FILES: "300",
    });
    expect(summary).toMatchObject({
      analyzerVersion: ANALYZER_VERSION,
      githubTokenConfigured: "yes",
      cacheMode: "memory (128 MB) + disk",
      rateLimitPerMinute: "disabled",
      logLevel: "info",
      limits: expect.objectContaining({ maxParsedFiles: 300 }),
    });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(configurationSummary({}).githubTokenConfigured).toBe("no");
  });
});

describe("startServerObservability", () => {
  it("logs exactly one startup line and installs the metrics sink", () => {
    const { lines, logger } = capture();
    const metrics: string[] = [];
    restore = setMetricsSink(noopMetricsSink);
    startServerObservability({
      env: { GITHUB_TOKEN: TOKEN },
      logger,
      metricsSink: { recordMetric: (name) => metrics.push(name) },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(TOKEN);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      msg: "codeverse server starting",
      githubTokenConfigured: "yes",
    });
    recordMetric("codeverse.test", 1);
    expect(metrics).toEqual(["codeverse.test"]);
  });

  it("chooses the metrics sink from CODEVERSE_METRICS", () => {
    const { lines, logger } = capture();
    restore = setMetricsSink(metricsSinkFromEnv({ CODEVERSE_METRICS: "off" }, logger));
    recordMetric("dropped", 1);
    setMetricsSink(metricsSinkFromEnv({ CODEVERSE_METRICS: "info" }, logger));
    recordMetric("kept", 1);
    expect(lines.map((line) => JSON.parse(line) as { level: string; metric: string })).toEqual([
      expect.objectContaining({ level: "info", metric: "kept" }),
    ]);
  });
});
