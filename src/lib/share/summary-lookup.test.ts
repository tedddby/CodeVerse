import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METRIC_NAMES, setMetricsSink, type MetricsSink } from "@/lib/observability/metrics";
import {
  getSummaryRateLimiter,
  resetRateLimiters,
  SUMMARY_REQUESTS_PER_MINUTE,
} from "@/lib/rate-limit/limiters";
import { getClientKey } from "@/lib/rate-limit/token-bucket";
import { takeSummaryLookup } from "./summary-lookup";

/** Burst of the summary limiter: a full bucket. */
const BURST = SUMMARY_REQUESTS_PER_MINUTE / 2;

function clientHeaders(address: string): Headers {
  return new Headers({ "x-forwarded-for": address, "user-agent": "test" });
}

/**
 * Shaped like the read-only view `next/headers` returns: a `Headers` subclass
 * whose own header list is empty, answering reads from another object.
 */
class ReadOnlyHeadersView extends Headers {
  constructor(private readonly source: Headers) {
    super();
  }
  override get(name: string): string | null {
    return this.source.get(name);
  }
  override has(name: string): boolean {
    return this.source.has(name);
  }
  override entries(): HeadersIterator<[string, string]> {
    return this.source.entries();
  }
  override [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this.source.entries();
  }
}

let previousSink: MetricsSink | null = null;
const recordMetric = vi.fn<MetricsSink["recordMetric"]>();

beforeEach(() => {
  vi.stubEnv("CODEVERSE_TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("CODEVERSE_CLIENT_IP_HEADER", "");
  resetRateLimiters();
  recordMetric.mockReset();
  previousSink = setMetricsSink({ recordMetric });
});

afterEach(() => {
  if (previousSink) setMetricsSink(previousSink);
  resetRateLimiters();
  vi.unstubAllEnvs();
});

describe("takeSummaryLookup", () => {
  it("allows a client's burst, then denies it without affecting other clients", () => {
    for (let i = 0; i < BURST; i += 1) {
      expect(takeSummaryLookup(clientHeaders("203.0.113.7"), "metadata")).toBe(true);
    }
    expect(takeSummaryLookup(clientHeaders("203.0.113.7"), "og-image")).toBe(false);
    expect(takeSummaryLookup(clientHeaders("198.51.100.4"), "metadata")).toBe(true);
    expect(recordMetric).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenCalledWith(METRIC_NAMES.clientRateLimited, 1, {
      route: "og-image",
    });
  });

  it("shares the bucket of the repository summary API", () => {
    const apiRequest = new Request("http://localhost/api/repo/acme/widgets", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    for (let i = 0; i < BURST; i += 1) {
      expect(getSummaryRateLimiter().take(getClientKey(apiRequest)).allowed).toBe(true);
    }
    expect(takeSummaryLookup(clientHeaders("203.0.113.7"), "metadata")).toBe(false);
  });

  it("identifies the client through a read-only header view", () => {
    for (let i = 0; i < BURST; i += 1) {
      expect(
        takeSummaryLookup(new ReadOnlyHeadersView(clientHeaders("203.0.113.7")), "metadata"),
      ).toBe(true);
    }
    expect(
      takeSummaryLookup(new ReadOnlyHeadersView(clientHeaders("203.0.113.7")), "metadata"),
    ).toBe(false);
    // Were the view read as empty, every client would share the "anonymous" bucket.
    expect(
      takeSummaryLookup(new ReadOnlyHeadersView(clientHeaders("198.51.100.4")), "metadata"),
    ).toBe(true);
  });

  it("denies the lookup when the headers cannot be read", () => {
    const broken = new Headers();
    vi.spyOn(broken, "entries").mockImplementation(() => {
      throw new TypeError("unreadable");
    });
    expect(takeSummaryLookup(broken, "metadata")).toBe(false);
  });
});
