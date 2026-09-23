import { describe, expect, it } from "vitest";
import { RateLimitTracker, parseRateLimitHeaders, parseRetryAfterMs } from "./rate-limit";

describe("parseRateLimitHeaders", () => {
  it("parses limit, remaining, reset and resource", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4987",
      "x-ratelimit-reset": "1758650400",
      "x-ratelimit-resource": "graphql",
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      resource: "graphql",
      limit: 5000,
      remaining: 4987,
      resetAt: new Date(1_758_650_400_000).toISOString(),
    });
  });

  it("defaults the resource to core", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": "59",
      "x-ratelimit-reset": "1758650400",
    });
    expect(parseRateLimitHeaders(headers)?.resource).toBe("core");
  });

  it.each([
    [{}],
    [{ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59" }],
    [{ "x-ratelimit-limit": "sixty", "x-ratelimit-remaining": "59", "x-ratelimit-reset": "1" }],
    [{ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "-1", "x-ratelimit-reset": "1" }],
  ])("returns undefined for missing or malformed headers %#", (raw) => {
    expect(parseRateLimitHeaders(new Headers(raw))).toBeUndefined();
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");

  it("reads delta seconds and HTTP dates", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "3" }), now)).toBe(3_000);
    expect(
      parseRetryAfterMs(new Headers({ "retry-after": "Wed, 23 Sep 2026 12:00:10 GMT" }), now),
    ).toBe(10_000);
    expect(
      parseRetryAfterMs(new Headers({ "retry-after": "Wed, 23 Sep 2026 11:00:00 GMT" }), now),
    ).toBe(0);
  });

  it("ignores absent or malformed values", () => {
    expect(parseRetryAfterMs(new Headers(), now)).toBeUndefined();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "soon" }), now)).toBeUndefined();
  });
});

describe("RateLimitTracker", () => {
  const reading = (remaining: number, resetSeconds: number, resource = "core") => ({
    resource,
    limit: 5000,
    remaining,
    resetAt: new Date(resetSeconds * 1000).toISOString(),
  });

  it("keeps the lowest remaining value within one window (out-of-order responses)", () => {
    const tracker = new RateLimitTracker();
    tracker.record(reading(4990, 1000));
    tracker.record(reading(4995, 1000));
    expect(tracker.get("core")?.remaining).toBe(4990);
    tracker.record(reading(4980, 1000));
    expect(tracker.get("core")?.remaining).toBe(4980);
  });

  it("replaces readings from an older window and ignores stale ones", () => {
    const tracker = new RateLimitTracker();
    tracker.record(reading(3, 1000));
    tracker.record(reading(4999, 5000));
    expect(tracker.get("core")?.remaining).toBe(4999);
    tracker.record(reading(1, 1000));
    expect(tracker.get("core")?.remaining).toBe(4999);
  });

  it("tracks resources separately and snapshots with authentication state", () => {
    const tracker = new RateLimitTracker();
    tracker.record(reading(10, 1000, "graphql"));
    expect(tracker.snapshot("core", true)).toBeUndefined();
    expect(tracker.snapshot("graphql", true)).toEqual({
      limit: 5000,
      remaining: 10,
      resetAt: new Date(1_000_000).toISOString(),
      authenticated: true,
    });
  });
});
