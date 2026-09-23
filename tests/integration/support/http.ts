/**
 * Helpers for invoking route handlers directly with Request objects.
 */
import { afterEach, beforeEach, vi } from "vitest";
import type { AnalysisEvent } from "@/analysis/protocol";
import { resetRateLimiters } from "@/lib/rate-limit/limiters";

export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const RESOLVED_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** Route context with already-resolved dynamic params. */
export function params(owner: string, repo: string) {
  return { params: Promise.resolve({ owner, repo }) };
}

/** A request from one client address (the rate limiters key on it). */
export function request(url: string, init: RequestInit & { ip?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", init.ip ?? "203.0.113.7");
  return new Request(new URL(url, "http://localhost"), { ...init, headers });
}

/** Parses an NDJSON response body into events. */
export async function readEvents(response: Response): Promise<AnalysisEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AnalysisEvent);
}

/**
 * Registers per-test setup: fresh rate limiters, default configuration and
 * reset mocks. Expected failures are logged as structured error lines, which
 * are silenced to keep the test output readable.
 */
export function setupRouteTests(mocks: Record<string, { mockReset(): unknown }>): void {
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("CODEVERSE_RATE_LIMIT_PER_MINUTE", "");
    resetRateLimiters();
    for (const mock of Object.values(mocks)) mock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimiters();
  });
}
