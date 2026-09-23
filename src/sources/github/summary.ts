import { raceWithSignal, throwIfAborted } from "@/github/async";
import type { GitHubClient } from "@/github/client";
import { ExpiringCache } from "@/github/lru-cache";
import { assertOwner, assertRepoName } from "@/github/validation";
import { isSourceError } from "@/sources/types";
import { fetchRepositoryMetadata, type RepositorySummary } from "./snapshot";

/**
 * Lightweight repository metadata for page metadata and Open Graph images.
 * One ETag-conditional REST call, fronted by a short in-process cache that also
 * de-duplicates concurrent requests (metadata and the OG image of the same page
 * are typically rendered at the same time).
 */

export const SUMMARY_TTL_MS = 60_000;
/** Definitive failures (not found / not public) are remembered briefly to absorb crawler bursts. */
export const SUMMARY_ERROR_TTL_MS = 30_000;
const SUMMARY_CACHE_SIZE = 1_000;
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
 * Fetches a public repository's metadata with the given client. Throws
 * `SourceError` (INVALID_REPOSITORY for malformed names, PRIVATE_OR_INACCESSIBLE
 * for non-public repositories, NOT_FOUND, RATE_LIMITED, ...).
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
    () => fetchRepositoryMetadata(client, owner, repo),
    errorTtl,
  );
  return structuredClone(await raceWithSignal(shared, signal));
}
