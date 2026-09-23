import { describe, expect, it } from "vitest";
import { SourceError } from "@/sources/types";
import { GitHubApiError, mapResponseError, mapTransportError, readUpstreamMessage } from "./errors";
import { cleanSingleLine, firstLine, normalizeIsoDate, redactSecret, truncate } from "./text";

const NOW = Date.parse("2026-09-23T12:00:00Z");

function map(status: number, headers: Record<string, string> = {}, body: unknown = undefined) {
  return mapResponseError({
    status,
    headers: new Headers(headers),
    bodyText: body === undefined ? "" : JSON.stringify(body),
    now: NOW,
  });
}

describe("mapResponseError", () => {
  it.each([
    [401, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
    [410, "NOT_FOUND"],
    [409, "EMPTY_REPOSITORY"],
    [422, "NOT_FOUND"],
    [451, "PRIVATE_OR_INACCESSIBLE"],
    [500, "UPSTREAM_ERROR"],
    [502, "UPSTREAM_ERROR"],
    [400, "UPSTREAM_ERROR"],
  ])("maps HTTP %i to %s", (status, code) => {
    const error = map(status);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toBeInstanceOf(SourceError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it("maps an exhausted primary rate limit with the reset time", () => {
    const error = map(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAt).toBe(new Date(1_790_000_000_000).toISOString());
    expect(error.retryAfterMs).toBeUndefined();
  });

  it("maps 429 with an exhausted quota the same way", () => {
    const error = map(429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.status).toBe(429);
  });

  it("maps a secondary rate limit announced by retry-after", () => {
    const error = map(403, { "retry-after": "30", "x-ratelimit-remaining": "4000" });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.retryAt).toBe(new Date(NOW + 30_000).toISOString());
  });

  it("maps a secondary rate limit recognised by its message", () => {
    const error = map(
      403,
      {},
      { message: "You have exceeded a secondary rate limit. Please wait." },
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAt).toBe(new Date(NOW + 60_000).toISOString());
  });

  it("maps any other 403 to PRIVATE_OR_INACCESSIBLE and keeps GitHub's message separately", () => {
    const error = map(403, {}, { message: "Repository access blocked" });
    expect(error.code).toBe("PRIVATE_OR_INACCESSIBLE");
    expect(error.upstreamMessage).toBe("Repository access blocked");
    expect(error.message).not.toContain("Repository access blocked");
  });

  it("maps a bare 429 to RATE_LIMITED", () => {
    expect(map(429).code).toBe("RATE_LIMITED");
  });
});

describe("readUpstreamMessage", () => {
  it("sanitizes, truncates and redacts the upstream message", () => {
    const body = JSON.stringify({ message: `bad\u0000 token ghp_secret123\n${"x".repeat(400)}` });
    const message = readUpstreamMessage(body, "ghp_secret123");
    expect(message).toBeDefined();
    expect(message).not.toContain("ghp_secret123");
    expect(message).toContain("[redacted]");
    expect(message).not.toMatch(/[\u0000-\u001f]/);
    expect(message?.length).toBeLessThanOrEqual(300);
  });

  it("returns undefined for non-JSON or message-less bodies", () => {
    expect(readUpstreamMessage("<html>", undefined)).toBeUndefined();
    expect(readUpstreamMessage(JSON.stringify({ error: "x" }))).toBeUndefined();
    expect(readUpstreamMessage(JSON.stringify({ message: 42 }))).toBeUndefined();
    expect(readUpstreamMessage("")).toBeUndefined();
  });
});

describe("mapTransportError", () => {
  const timeoutMs = 20_000;

  it("prefers caller cancellation over the timeout", () => {
    const caller = new AbortController();
    caller.abort();
    const timeout = new AbortController();
    timeout.abort();
    const error = mapTransportError(new DOMException("aborted", "AbortError"), {
      callerSignal: caller.signal,
      timeoutSignal: timeout.signal,
      timeoutMs,
    });
    expect(error.code).toBe("ABORTED");
  });

  it("reports timeouts, including ABORTED errors raised while the timeout fired", () => {
    const timeout = new AbortController();
    timeout.abort();
    expect(
      mapTransportError(new DOMException("t", "TimeoutError"), {
        timeoutSignal: timeout.signal,
        timeoutMs,
      }).code,
    ).toBe("TIMEOUT");
    expect(
      mapTransportError(new SourceError("ABORTED", "x"), {
        timeoutSignal: timeout.signal,
        timeoutMs,
      }).code,
    ).toBe("TIMEOUT");
  });

  it("maps other failures to NETWORK_ERROR with a redacted, rebuilt cause", () => {
    const error = mapTransportError(new TypeError("fetch failed for token abc123"), {
      timeoutSignal: new AbortController().signal,
      timeoutMs,
      secret: "abc123",
    });
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.cause).toBeInstanceOf(Error);
    expect(String((error.cause as Error).message)).not.toContain("abc123");
  });

  it("passes SourceErrors through", () => {
    const original = new SourceError("NOT_FOUND", "x");
    expect(
      mapTransportError(original, { timeoutSignal: new AbortController().signal, timeoutMs }),
    ).toBe(original);
  });
});

describe("text helpers", () => {
  it("cleans untrusted single-line text", () => {
    expect(cleanSingleLine("  a\tb\u0007c \u009b\n d  ", 100)).toBe("a bc d");
    expect(cleanSingleLine("x\ud800y", 10)).toBe(`x${String.fromCharCode(0xfffd)}y`);
  });

  it("takes the first line of commit messages and truncates safely", () => {
    expect(firstLine("Subject line\r\n\r\nBody", 300)).toBe("Subject line");
    expect(firstLine("  padded subject  \nbody", 300)).toBe("padded subject");
    expect(firstLine("a".repeat(400), 300)).toHaveLength(300);
    expect(truncate("ab🚀cd", 4)).toBe("ab…");
  });

  it("redacts every occurrence of a secret", () => {
    expect(redactSecret("t=s3cr3t&u=s3cr3t", "s3cr3t")).toBe("t=[redacted]&u=[redacted]");
    expect(redactSecret("nothing", undefined)).toBe("nothing");
  });

  it("normalizes dates to UTC ISO strings", () => {
    expect(normalizeIsoDate("2026-09-20T14:34:56+02:00")).toBe("2026-09-20T12:34:56.000Z");
    expect(normalizeIsoDate("not a date")).toBeUndefined();
    expect(normalizeIsoDate(null)).toBeUndefined();
  });
});
