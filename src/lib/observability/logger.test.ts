import { describe, expect, it } from "vitest";
import { createLogger, parseLogLevel, type LogLevel, type LogSink } from "./logger";

const TOKEN = "ghp_LoggerTestSecret0123456789abcdefABCD";

function memorySink() {
  const records: Array<{ level: LogLevel; record: Record<string, unknown>; line: string }> = [];
  const sink: LogSink = {
    write(level, line) {
      records.push({ level, line, record: JSON.parse(line) as Record<string, unknown> });
    },
  };
  return { sink, records };
}

const FIXED = Date.parse("2026-09-23T10:00:00.000Z");

describe("createLogger", () => {
  it("writes one JSON line per record with time, level and message first", () => {
    const { sink, records } = memorySink();
    createLogger({ sink, now: () => FIXED, fields: { service: "codeverse" } }).info(
      "analysis complete",
      {
        files: 12,
      },
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.line).toBe(
      '{"time":"2026-09-23T10:00:00.000Z","level":"info","msg":"analysis complete","service":"codeverse","files":12}',
    );
  });

  it("filters by level", () => {
    const { sink, records } = memorySink();
    const logger = createLogger({ sink, level: "warn" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records.map((entry) => entry.level)).toEqual(["warn", "error"]);
    const silent = memorySink();
    createLogger({ sink: silent.sink, level: "silent" }).error("nothing");
    expect(silent.records).toEqual([]);
  });

  it("never lets a token reach the output", () => {
    const { sink, records } = memorySink();
    const logger = createLogger({ sink, level: "debug" }).child({
      authorization: `Bearer ${TOKEN}`,
    });
    logger.error(`request failed for ${TOKEN}`, {
      error: new Error(`GitHub rejected ${TOKEN}`),
      headers: { Authorization: `token ${TOKEN}`, cookie: "session=abc" },
      url: `https://api.github.com/repos?access_token=${TOKEN}`,
      nested: [{ githubToken: TOKEN }],
    });
    const line = records[0]?.line ?? "";
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain("session=abc");
    expect(records[0]?.record).toMatchObject({
      authorization: "[REDACTED]",
      headers: { Authorization: "[REDACTED]", cookie: "[REDACTED]" },
    });
  });

  it("merges child fields and protects the envelope keys", () => {
    const { sink, records } = memorySink();
    const logger = createLogger({ sink, now: () => FIXED }).child({ repo: "a/b", stage: "tree" });
    logger.child({ stage: "parse" }).info("step", { level: "fake", msg: "fake", time: 1 });
    expect(records[0]?.record).toEqual({
      time: "2026-09-23T10:00:00.000Z",
      level: "info",
      msg: "step",
      repo: "a/b",
      stage: "parse",
      "field.level": "fake",
      "field.msg": "fake",
      "field.time": 1,
    });
  });

  it("survives unserializable fields and failing sinks", () => {
    const { sink, records } = memorySink();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    createLogger({ sink }).info("cyclic", { cyclic, big: 1n });
    expect(records[0]?.record).toMatchObject({ cyclic: { self: "[Circular]" }, big: "1" });
    const broken = createLogger({
      sink: {
        write() {
          throw new Error("disk full");
        },
      },
    });
    expect(() => broken.error("still fine")).not.toThrow();
  });
});

describe("parseLogLevel", () => {
  it.each([
    ["debug", "debug"],
    [" WARN ", "warn"],
    ["silent", "silent"],
    ["verbose", "info"],
    [undefined, "info"],
    ["constructor", "info"],
  ])("parses %j as %s", (value, expected) => {
    expect(parseLogLevel(value)).toBe(expected);
  });
});
