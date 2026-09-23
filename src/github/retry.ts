import type { SourceError } from "@/sources/types";
import { isGitHubApiError } from "./errors";

/**
 * Retry policy for GitHub requests: transient failures (network errors, 5xx)
 * back off exponentially with jitter (~300 ms, ~900 ms, ...); a secondary rate
 * limit is retried only when GitHub asks to wait at most five seconds. Every
 * other failure (4xx, primary rate limits, timeouts, cancellation) is final.
 */

export const BASE_BACKOFF_MS = 300;
export const MAX_SECONDARY_RETRY_MS = 5_000;

export interface RetryPolicy {
  maxRetries: number;
  /** Random source in [0, 1) for jitter. */
  random: () => number;
}

/** Delay before the next attempt, or undefined when `error` must not be retried. */
export function retryDelay(
  error: SourceError,
  attempt: number,
  policy: RetryPolicy,
): number | undefined {
  if (attempt >= policy.maxRetries) return undefined;
  const backoff = Math.round(BASE_BACKOFF_MS * 3 ** attempt * (0.8 + policy.random() * 0.4));
  if (error.code === "NETWORK_ERROR") return backoff;
  if (error.code === "UPSTREAM_ERROR" && error.status !== undefined && error.status >= 500) {
    return backoff;
  }
  if (
    isGitHubApiError(error) &&
    error.code === "RATE_LIMITED" &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs <= MAX_SECONDARY_RETRY_MS
  ) {
    return Math.max(error.retryAfterMs, backoff);
  }
  return undefined;
}
