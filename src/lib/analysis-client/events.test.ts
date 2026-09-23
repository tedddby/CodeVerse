import { describe, expect, it } from "vitest";
import { ERROR_COPY } from "@/analysis/protocol";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  errorFromHttpStatus,
  extractErrorPayload,
  isRepositoryGraphLike,
  normalizeErrorPayload,
  parseAnalysisEventLine,
  parseRetryAfter,
} from "./events";

describe("parseAnalysisEventLine", () => {
  it("accepts every event type of the protocol", () => {
    expect(parseAnalysisEventLine('{"type":"heartbeat"}')).toEqual({ ok: true, event: { type: "heartbeat" } });
    expect(parseAnalysisEventLine('{"type":"stage","stage":"tree","status":"start"}')).toEqual({
      ok: true,
      event: { type: "stage", stage: "tree", status: "start" },
    });
    const preview = parseAnalysisEventLine(JSON.stringify({ type: "preview", graph: mockRepositoryGraph }));
    expect(preview.ok && preview.event.type).toBe("preview");
  });

  it("drops non-finite progress and strips control characters from messages", () => {
    const result = parseAnalysisEventLine(
      JSON.stringify({ type: "stage", stage: "parse", status: "progress", progress: "0.5", message: "a\u0007b\nc" }),
    );
    expect(result).toEqual({ ok: true, event: { type: "stage", stage: "parse", status: "progress", message: "a b c" } });
  });

  it("rejects prototype-pollution style payloads as unknown events", () => {
    expect(parseAnalysisEventLine('{"__proto__":{"type":"complete"}}')).toEqual({ ok: false, reason: "missing event type" });
  });
});

describe("isRepositoryGraphLike", () => {
  it("accepts a real graph and rejects structurally broken ones", () => {
    expect(isRepositoryGraphLike(mockRepositoryGraph)).toBe(true);
    expect(isRepositoryGraphLike({ ...mockRepositoryGraph, files: {} })).toBe(false);
    expect(isRepositoryGraphLike({ ...mockRepositoryGraph, schemaVersion: 2 })).toBe(false);
    expect(isRepositoryGraphLike({ ...mockRepositoryGraph, repository: null })).toBe(false);
    expect(isRepositoryGraphLike(null)).toBe(false);
  });
});

describe("normalizeErrorPayload", () => {
  it("fills missing copy from ERROR_COPY and keeps server specifics", () => {
    expect(normalizeErrorPayload({ code: "NOT_FOUND" })).toEqual({ code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND });
    expect(normalizeErrorPayload({ code: "TIMEOUT", message: "GitHub took 30s." })).toEqual({
      code: "TIMEOUT",
      title: ERROR_COPY.TIMEOUT.title,
      message: "GitHub took 30s.",
    });
  });

  it("maps unknown codes to INTERNAL and validates retryAt", () => {
    expect(normalizeErrorPayload({ code: "EVIL", title: 42, retryAt: "not a date" })).toEqual({
      code: "INTERNAL",
      ...ERROR_COPY.INTERNAL,
    });
    expect(normalizeErrorPayload({ code: "RATE_LIMITED", retryAt: "2026-09-23T12:00:00Z" })?.retryAt).toBe(
      "2026-09-23T12:00:00.000Z",
    );
    expect(normalizeErrorPayload("NOT_FOUND")).toBeNull();
  });
});

describe("extractErrorPayload", () => {
  it("finds an NDJSON error event after other lines", () => {
    const body = `{"type":"stage","stage":"connect","status":"start"}\n{"type":"error","error":{"code":"RATE_LIMITED","retryAt":"2026-09-23T12:00:00Z"}}\n`;
    expect(extractErrorPayload(body)).toMatchObject({ code: "RATE_LIMITED", retryAt: "2026-09-23T12:00:00.000Z" });
  });

  it("accepts plain and pretty-printed JSON bodies", () => {
    expect(extractErrorPayload('{"error":{"code":"NOT_FOUND"}}')?.code).toBe("NOT_FOUND");
    expect(extractErrorPayload(JSON.stringify({ error: { code: "INVALID_REPOSITORY" } }, null, 2))?.code).toBe(
      "INVALID_REPOSITORY",
    );
  });

  it("returns null for bodies without an error payload", () => {
    expect(extractErrorPayload("<html>Bad gateway</html>")).toBeNull();
    expect(extractErrorPayload("")).toBeNull();
    expect(extractErrorPayload('{"message":"nope"}')).toBeNull();
  });
});

describe("errorFromHttpStatus", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");

  it.each([
    [400, "INVALID_REPOSITORY"],
    [401, "UNAUTHORIZED"],
    [403, "PRIVATE_OR_INACCESSIBLE"],
    [404, "NOT_FOUND"],
    [429, "CLIENT_RATE_LIMITED"],
    [502, "UPSTREAM_ERROR"],
    [504, "TIMEOUT"],
    [500, "INTERNAL"],
  ] as const)("maps HTTP %i to %s", (status, code) => {
    expect(errorFromHttpStatus(status, null, now)).toEqual({ code, ...ERROR_COPY[code] });
  });

  it("derives retryAt from Retry-After seconds or dates", () => {
    expect(errorFromHttpStatus(429, "60", now).retryAt).toBe("2026-09-23T12:01:00.000Z");
    expect(parseRetryAfter("Wed, 23 Sep 2026 12:05:00 GMT", now)).toBe("2026-09-23T12:05:00.000Z");
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });
});
