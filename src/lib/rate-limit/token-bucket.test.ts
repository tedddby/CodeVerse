import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANALYSES_PER_MINUTE,
  getAnalyzeRateLimiter,
  readAnalysesPerMinute,
  resetRateLimiters,
} from "./limiters";
import { createRateLimiter, getClientKey } from "./token-bucket";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("createRateLimiter", () => {
  it("allows a burst up to capacity, then rejects with the time to the next token", () => {
    const time = clock();
    const limiter = createRateLimiter({ capacity: 3, refillPerMinute: 6, now: time.now });
    expect([1, 2, 3].map(() => limiter.take("a").allowed)).toEqual([true, true, true]);
    // 6 tokens per minute: one every 10 seconds.
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterMs: 10_000 });
    time.advance(4_000);
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterMs: 6_000 });
    time.advance(6_000);
    expect(limiter.take("a")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("refills continuously but never beyond capacity", () => {
    const time = clock();
    const limiter = createRateLimiter({ capacity: 2, refillPerMinute: 60, now: time.now });
    limiter.take("a");
    limiter.take("a");
    time.advance(10 * 60_000);
    expect([1, 2, 3].map(() => limiter.take("a").allowed)).toEqual([true, true, false]);
  });

  it("tracks clients independently", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerMinute: 1, now: () => 0 });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);
  });

  it("bounds memory by evicting the least recently seen clients", () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerMinute: 1,
      maxKeys: 2,
      now: () => 0,
    });
    limiter.take("a");
    limiter.take("b");
    limiter.take("a"); // "a" is now the most recently seen; "b" is evicted next.
    limiter.take("c");
    // "b" was forgotten and starts with a full bucket again; "a" is still limited.
    expect(limiter.take("b").allowed).toBe(true);
    expect(limiter.take("c").allowed).toBe(false);
  });

  it("rejects invalid configurations", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerMinute: 1 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: 1, refillPerMinute: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: Number.NaN, refillPerMinute: 1 })).toThrow(
      RangeError,
    );
  });
});

describe("getClientKey", () => {
  const key = (headers: Record<string, string>) =>
    getClientKey(new Request("http://localhost/api", { headers }));

  it("uses the first forwarded address, then x-real-ip, then a shared anonymous key", () => {
    expect(key({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" })).toBe(
      key({ "x-forwarded-for": "203.0.113.1" }),
    );
    expect(key({ "x-forwarded-for": "203.0.113.1" })).not.toBe(
      key({ "x-forwarded-for": "203.0.113.2" }),
    );
    expect(key({ "x-real-ip": "198.51.100.4" })).toBe(key({ "x-forwarded-for": "198.51.100.4" }));
    expect(key({})).toBe(key({ "x-forwarded-for": " " }));
  });

  it("returns a SHA-256 digest that does not contain the address", () => {
    const digest = key({ "x-forwarded-for": "2001:db8::1" });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("2001");
    expect(key({ "x-forwarded-for": "2001:DB8::1" })).toBe(digest);
  });
});

describe("route limiters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimiters();
  });

  it("reads the analysis limit from the environment", () => {
    expect(readAnalysesPerMinute({})).toBe(DEFAULT_ANALYSES_PER_MINUTE);
    expect(readAnalysesPerMinute({ CODEVERSE_RATE_LIMIT_PER_MINUTE: "30" })).toBe(30);
    expect(readAnalysesPerMinute({ CODEVERSE_RATE_LIMIT_PER_MINUTE: "0" })).toBe(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(readAnalysesPerMinute({ CODEVERSE_RATE_LIMIT_PER_MINUTE: "-1" })).toBe(
      DEFAULT_ANALYSES_PER_MINUTE,
    );
    expect(readAnalysesPerMinute({ CODEVERSE_RATE_LIMIT_PER_MINUTE: "1.5" })).toBe(
      DEFAULT_ANALYSES_PER_MINUTE,
    );
  });

  it("disables the analysis limiter with 0", () => {
    vi.stubEnv("CODEVERSE_RATE_LIMIT_PER_MINUTE", "0");
    resetRateLimiters();
    expect(getAnalyzeRateLimiter()).toBeNull();
    vi.stubEnv("CODEVERSE_RATE_LIMIT_PER_MINUTE", "1");
    resetRateLimiters();
    const limiter = getAnalyzeRateLimiter();
    expect(limiter?.take("x").allowed).toBe(true);
    expect(limiter?.take("x").allowed).toBe(false);
  });
});
