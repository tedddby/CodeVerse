import { createHmac, randomBytes } from "node:crypto";
import { clientAddress, type ClientAddressConfig } from "./client-address";

/**
 * In-process token-bucket rate limiting per client.
 *
 * Each key owns a bucket of `capacity` tokens refilled continuously at
 * `refillPerMinute`; a request takes one token. Memory is bounded: buckets are
 * kept in an LRU of at most `maxKeys` entries (an evicted client simply starts
 * again with a full bucket).
 *
 * This limiter is per server instance. Behind several instances, each one
 * enforces the limit independently, which bounds abuse without shared state.
 */

export interface RateLimiterOptions {
  /** Burst size: requests allowed at once from a full bucket. */
  capacity: number;
  /** Tokens added per minute. */
  refillPerMinute: number;
  /** Maximum tracked clients (default 10,000). */
  maxKeys?: number;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** When rejected: milliseconds until one token is available again (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  take(key: string): RateLimitDecision;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;
const MINUTE_MS = 60_000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerMinute } = options;
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new RangeError("Rate limiter capacity must be at least 1");
  }
  if (!Number.isFinite(refillPerMinute) || refillPerMinute <= 0) {
    throw new RangeError("Rate limiter refill rate must be positive");
  }
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_MAX_KEYS));
  const now = options.now ?? Date.now;
  const tokensPerMs = refillPerMinute / MINUTE_MS;
  const buckets = new Map<string, Bucket>();

  return {
    take(key: string): RateLimitDecision {
      const time = now();
      const existing = buckets.get(key);
      let bucket: Bucket;
      if (existing) {
        const elapsed = Math.max(0, time - existing.updatedAt);
        bucket = {
          tokens: Math.min(capacity, existing.tokens + elapsed * tokensPerMs),
          updatedAt: time,
        };
        buckets.delete(key);
      } else {
        bucket = { tokens: capacity, updatedAt: time };
      }

      let decision: RateLimitDecision;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        decision = { allowed: true, retryAfterMs: 0 };
      } else {
        decision = { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / tokensPerMs) };
      }

      // Re-insert as most recently used; evict the least recently used clients.
      buckets.set(key, bucket);
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      return decision;
    },
  };
}

/**
 * Per-process secret for client key hashing: keys are stable within a process
 * but cannot be reversed into IP addresses by brute force.
 */
const CLIENT_KEY_SECRET = randomBytes(32);
const MAX_ADDRESS_LENGTH = 100;

/**
 * Identifies the client of a request for rate limiting: the address added by
 * the deployment's trusted proxies (see `client-address.ts`), else
 * "anonymous". Returns a keyed SHA-256 digest, never the raw address.
 */
export function getClientKey(request: Request, config?: ClientAddressConfig): string {
  const address = (clientAddress(request, config) ?? "anonymous")
    .slice(0, MAX_ADDRESS_LENGTH)
    .toLowerCase();
  return createHmac("sha256", CLIENT_KEY_SECRET).update(address, "utf8").digest("hex");
}
