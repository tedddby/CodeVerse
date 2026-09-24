import { METRIC_NAMES, recordMetric } from "@/lib/observability/metrics";
import { getSummaryRateLimiter } from "@/lib/rate-limit/limiters";
import { getClientKey } from "@/lib/rate-limit/token-bucket";

/**
 * Per-client budget for the repository lookups that only enrich a page (page
 * metadata, the social card). They draw on the same limiter as
 * `/api/repo/{owner}/{repo}`, so requesting pages for many repository names
 * cannot spend GitHub quota faster than the summary API allows. Callers fall
 * back to generic copy when a lookup is denied: a page never fails over it.
 */

/** Placeholder origin: only the headers of the synthetic request are read. */
const SYNTHETIC_URL = "http://codeverse.internal/";

/** Where the lookup happens, for the rate-limited metric. */
export type SummaryLookupRoute = "metadata" | "og-image";

/**
 * Takes one token from the summary limiter for the client behind
 * `requestHeaders` (e.g. `await headers()` from `next/headers`). Returns false
 * when the client is over its budget, or when its identity cannot be read.
 */
export function takeSummaryLookup(requestHeaders: Headers, route: SummaryLookupRoute): boolean {
  let clientKey: string;
  try {
    // Built from the entries (reads only), so any header view works, including
    // the read-only one from `next/headers`.
    const request = new Request(SYNTHETIC_URL, { headers: Array.from(requestHeaders.entries()) });
    clientKey = getClientKey(request);
  } catch {
    return false;
  }
  const decision = getSummaryRateLimiter().take(clientKey);
  if (!decision.allowed) recordMetric(METRIC_NAMES.clientRateLimited, 1, { route });
  return decision.allowed;
}
