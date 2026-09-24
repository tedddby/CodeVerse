import { raceWithSignal, throwIfAborted } from "@/github/async";
import type { GitHubClient } from "@/github/client";
import { ExpiringCache } from "@/github/lru-cache";
import { assertOwner, assertRepoName } from "@/github/validation";
import { SourceError, isSourceError, type SourceErrorCode } from "@/sources/types";
import { recentMetadata } from "./metadata-cache";
import { fetchRepositoryMetadata, type RepositorySummary } from "./snapshot";

/**
 * Lightweight repository metadata for page metadata and Open Graph images.
 * One ETag-conditional REST call, fronted by a short in-process cache that also
 * de-duplicates concurrent requests (metadata and the OG image of the same page
 * are typically rendered at the same time).
 *
 * These lookups are optional enrichment, and every page view (or crawler hit
 * with a made-up name) would otherwise spend the server's shared API quota.
 * They therefore stop calling GitHub once the quota falls to the share kept
 * for analyses, and serve the last known summary of a repository (up to a
 * day old) whenever GitHub cannot be asked.
 */

export const SUMMARY_TTL_MS = 60_000;
/** Definitive failures (not found / not public) are remembered to absorb crawler bursts. */
export const SUMMARY_ERROR_TTL_MS = 2 * 60_000;
/** Share of the REST quota kept for analyses: optional lookups stop calling GitHub below it. */
export const ANALYSIS_QUOTA_SHARE = 0.5;
/** Oldest last-known summary served when GitHub cannot be asked. */
export const STALE_SUMMARY_MAX_AGE_MS = 24 * 60 * 60_000;
const SUMMARY_CACHE_SIZE = 1_000;

/** Failures for which the last known summary is served instead. */
const STALE_CODES: ReadonlySet<SourceErrorCode> = new Set<SourceErrorCode>([
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "TIMEOUT",
]);

const summaryCaches = new WeakMap<GitHubClient, ExpiringCache<RepositorySummary>>();

function summaryCacheFor(client: GitHubClient): ExpiringCache<RepositorySummary> {
  let cache = summaryCaches.get(client);
  if (!cache) {
    cache = new ExpiringCache<RepositorySummary>({ maxEntries: SUMMARY_CACHE_SIZE });
    summaryCaches.set(client, cache);
  }
  return cache;
}

function errorTtl(error: unknown): number {
  return isSourceError(error) &&
    (error.code === "NOT_FOUND" || error.code === "PRIVATE_OR_INACCESSIBLE")
    ? SUMMARY_ERROR_TTL_MS
    : 0;
}

/**
 * RATE_LIMITED when the client's REST quota is down to the share reserved for
 * analyses (optional calls must not spend it), else null. Unknown quota, or a
 * window that has already reset, counts as available.
 */
export function reservedQuotaError(client: GitHubClient): SourceError | null {
  const reading = client.getRateLimit();
  if (!reading || client.hasCoreQuota(Math.ceil(reading.limit * ANALYSIS_QUOTA_SHARE))) return null;
  return new SourceError(
    "RATE_LIMITED",
    "The server's remaining GitHub API quota is reserved for analyses.",
    { retryAt: reading.resetAt },
  );
}

async function loadSummary(
  client: GitHubClient,
  owner: string,
  repo: string,
): Promise<RepositorySummary> {
  // Loaded moments ago by a snapshot of the same repository.
  const recent = recentMetadata(client, owner, repo, SUMMARY_TTL_MS);
  if (recent) return recent;
  try {
    const reserved = reservedQuotaError(client);
    if (reserved) throw reserved;
    return await fetchRepositoryMetadata(client, owner, repo);
  } catch (error) {
    const stale =
      isSourceError(error) && STALE_CODES.has(error.code)
        ? recentMetadata(client, owner, repo, STALE_SUMMARY_MAX_AGE_MS)
        : undefined;
    if (stale) return stale;
    throw error;
  }
}

/**
 * Fetches a public repository's metadata with the given client. Throws
 * `SourceError` (INVALID_REPOSITORY for malformed names, PRIVATE_OR_INACCESSIBLE
 * for non-public repositories, NOT_FOUND, RATE_LIMITED — also when the quota
 * is reserved for analyses and no earlier summary is known, ...).
 */
export async function fetchRepositorySummaryWith(
  client: GitHubClient,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<RepositorySummary> {
  assertOwner(owner);
  assertRepoName(repo);
  throwIfAborted(signal);
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const shared = summaryCacheFor(client).load(
    key,
    SUMMARY_TTL_MS,
    () => loadSummary(client, owner, repo),
    errorTtl,
  );
  return structuredClone(await raceWithSignal(shared, signal));
}
