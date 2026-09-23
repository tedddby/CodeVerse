import { describe, expect, it } from "vitest";
import { SourceError } from "@/sources/types";
import { GitHubApiError } from "./errors";
import { retryDelay } from "./retry";

const policy = (random: number, maxRetries = 2) => ({ maxRetries, random: () => random });

describe("retryDelay", () => {
  it("backs off exponentially with ±20% jitter for transient failures", () => {
    const network = new SourceError("NETWORK_ERROR", "x");
    expect(retryDelay(network, 0, policy(0.5))).toBe(300);
    expect(retryDelay(network, 1, policy(0.5))).toBe(900);
    expect(retryDelay(network, 0, policy(0))).toBe(240);
    expect(retryDelay(network, 0, policy(0.999_999))).toBe(360);
    const server = new GitHubApiError("UPSTREAM_ERROR", "x", { status: 503 });
    expect(retryDelay(server, 0, policy(0.5))).toBe(300);
  });

  it("stops after maxRetries", () => {
    const network = new SourceError("NETWORK_ERROR", "x");
    expect(retryDelay(network, 2, policy(0.5))).toBeUndefined();
    expect(retryDelay(network, 0, policy(0.5, 0))).toBeUndefined();
  });

  it("never retries client errors, primary rate limits, timeouts or cancellation", () => {
    for (const error of [
      new GitHubApiError("NOT_FOUND", "x", { status: 404 }),
      new GitHubApiError("UPSTREAM_ERROR", "x", { status: 400 }),
      new GitHubApiError("RATE_LIMITED", "x", { status: 403 }),
      new SourceError("TIMEOUT", "x"),
      new SourceError("ABORTED", "x"),
      new SourceError("INVALID_RESPONSE", "x"),
    ]) {
      expect(retryDelay(error, 0, policy(0.5))).toBeUndefined();
    }
  });

  it("retries secondary rate limits only for short retry-after values", () => {
    const short = new GitHubApiError("RATE_LIMITED", "x", { status: 403, retryAfterMs: 4_000 });
    const long = new GitHubApiError("RATE_LIMITED", "x", { status: 403, retryAfterMs: 6_000 });
    expect(retryDelay(short, 0, policy(0.5))).toBe(4_000);
    expect(retryDelay(long, 0, policy(0.5))).toBeUndefined();
  });
});
