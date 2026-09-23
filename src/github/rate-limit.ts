import type { RateLimitSnapshot } from "@/graph/model/types";

/**
 * GitHub reports quota on every API response through `x-ratelimit-*` headers.
 * Each quota "resource" (core REST, graphql, search, ...) is tracked
 * separately; the analysis pipeline cares about `core`.
 */

export interface RateLimitReading {
  resource: string;
  limit: number;
  remaining: number;
  /** ISO date when the window resets. */
  resetAt: string;
}

const NON_NEGATIVE_INTEGER = /^\d{1,12}$/;
const RESOURCE_NAME = /^[a-z_]{1,40}$/;

function readInteger(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim();
  if (!raw || !NON_NEGATIVE_INTEGER.test(raw)) return undefined;
  return Number(raw);
}

/** Parses the rate-limit headers of a response; undefined when absent or malformed. */
export function parseRateLimitHeaders(headers: Headers): RateLimitReading | undefined {
  const limit = readInteger(headers, "x-ratelimit-limit");
  const remaining = readInteger(headers, "x-ratelimit-remaining");
  const reset = readInteger(headers, "x-ratelimit-reset");
  if (limit === undefined || remaining === undefined || reset === undefined) return undefined;
  const rawResource = headers.get("x-ratelimit-resource")?.trim().toLowerCase();
  const resource = rawResource && RESOURCE_NAME.test(rawResource) ? rawResource : "core";
  return { resource, limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
}

/**
 * Parses `retry-after` (delta seconds or an HTTP date) into milliseconds from `now`.
 * Returns undefined when the header is absent or malformed.
 */
export function parseRetryAfterMs(headers: Headers, now: number): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  if (NON_NEGATIVE_INTEGER.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Keeps the most recent reading per resource. Responses of concurrent requests
 * arrive out of order, so within one window the lowest `remaining` wins and a
 * reading from an older window never replaces a newer one.
 */
export class RateLimitTracker {
  readonly #readings = new Map<string, RateLimitReading>();

  record(reading: RateLimitReading): void {
    const current = this.#readings.get(reading.resource);
    if (!current) {
      this.#readings.set(reading.resource, reading);
      return;
    }
    const currentReset = Date.parse(current.resetAt);
    const nextReset = Date.parse(reading.resetAt);
    if (nextReset > currentReset) {
      this.#readings.set(reading.resource, reading);
    } else if (nextReset === currentReset && reading.remaining < current.remaining) {
      this.#readings.set(reading.resource, { ...current, remaining: reading.remaining });
    }
  }

  get(resource: string): RateLimitReading | undefined {
    return this.#readings.get(resource);
  }

  snapshot(resource: string, authenticated: boolean): RateLimitSnapshot | undefined {
    const reading = this.#readings.get(resource);
    if (!reading) return undefined;
    return {
      limit: reading.limit,
      remaining: reading.remaining,
      resetAt: reading.resetAt,
      authenticated,
    };
  }
}
