import { logger } from "@/lib/observability/logger";
import { createRateLimiter, type RateLimiter } from "./token-bucket";

/**
 * Process-wide limiters for the public API routes, kept on `globalThis` so
 * development hot reloads keep their state.
 *
 * - Analyses: `CODEVERSE_RATE_LIMIT_PER_MINUTE` per client (default 12; 0 disables).
 * - Source viewer: 120 files per minute per client (bursts of 60). Files are
 *   read from GitHub's raw host at a pinned commit, which costs no API quota.
 * - Source files by branch or tag name: 10 per minute per client (each
 *   resolution costs API quota; the viewer itself always pins a commit).
 * - Repository summaries: 20 per minute per client.
 *
 * GitHub allows 60 API requests per hour without a token (5,000 with one) for
 * the whole server, far less than these per-client limits: routes that only
 * enrich pages also stop calling GitHub once the quota falls to the share
 * reserved for analyses (`reservedQuotaError`).
 */

export const DEFAULT_ANALYSES_PER_MINUTE = 12;
export const SOURCE_REQUESTS_PER_MINUTE = 120;
export const SOURCE_REF_RESOLUTIONS_PER_MINUTE = 10;
export const SUMMARY_REQUESTS_PER_MINUTE = 20;

type Env = Record<string, string | undefined>;

/** Parses `CODEVERSE_RATE_LIMIT_PER_MINUTE`: a non-negative integer, 0 meaning "disabled". */
export function readAnalysesPerMinute(env: Env = process.env): number {
  const raw = env.CODEVERSE_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return DEFAULT_ANALYSES_PER_MINUTE;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0) return value;
  logger.warn("ignoring invalid CODEVERSE_RATE_LIMIT_PER_MINUTE", { value: raw });
  return DEFAULT_ANALYSES_PER_MINUTE;
}

const LIMITERS_KEY = Symbol.for("codeverse.rateLimiters");

interface Limiters {
  analyze: RateLimiter | null;
  source: RateLimiter;
  sourceRef: RateLimiter;
  summary: RateLimiter;
}

type Holder = { [LIMITERS_KEY]?: Limiters };

function limiters(): Limiters {
  const holder = globalThis as typeof globalThis & Holder;
  let current = holder[LIMITERS_KEY];
  if (!current) {
    const analysesPerMinute = readAnalysesPerMinute();
    current = {
      analyze:
        analysesPerMinute > 0
          ? createRateLimiter({ capacity: analysesPerMinute, refillPerMinute: analysesPerMinute })
          : null,
      source: createRateLimiter({
        capacity: SOURCE_REQUESTS_PER_MINUTE / 2,
        refillPerMinute: SOURCE_REQUESTS_PER_MINUTE,
      }),
      sourceRef: createRateLimiter({
        capacity: SOURCE_REF_RESOLUTIONS_PER_MINUTE,
        refillPerMinute: SOURCE_REF_RESOLUTIONS_PER_MINUTE,
      }),
      summary: createRateLimiter({
        capacity: SUMMARY_REQUESTS_PER_MINUTE / 2,
        refillPerMinute: SUMMARY_REQUESTS_PER_MINUTE,
      }),
    };
    holder[LIMITERS_KEY] = current;
  }
  return current;
}

/** Limiter for `/api/analyze`, or null when disabled by configuration. */
export function getAnalyzeRateLimiter(): RateLimiter | null {
  return limiters().analyze;
}

export function getSourceRateLimiter(): RateLimiter {
  return limiters().source;
}

/** Extra limiter for source requests naming a branch or tag (resolved through the API). */
export function getSourceRefRateLimiter(): RateLimiter {
  return limiters().sourceRef;
}

export function getSummaryRateLimiter(): RateLimiter {
  return limiters().summary;
}

/** Drops every limiter so the next call re-reads configuration (tests only). */
export function resetRateLimiters(): void {
  const holder = globalThis as typeof globalThis & Holder;
  delete holder[LIMITERS_KEY];
}
