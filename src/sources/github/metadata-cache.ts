import type { GitHubClient } from "@/github/client";
import { LruCache } from "@/github/lru-cache";
import type { RepositorySummary } from "./snapshot";

/**
 * The latest successfully loaded metadata (GET /repos/{owner}/{repo}) per
 * repository and client, keyed by the requested name. Snapshot resolution and
 * repository summaries share it, so a page view that renders metadata and
 * then resolves the snapshot of the same repository costs one call instead of
 * two; older entries are the "last known good" summary served when GitHub
 * cannot be asked. Entries hold public metadata only.
 */

const MAX_ENTRIES = 1_000;

interface Entry {
  summary: RepositorySummary;
  loadedAt: number;
}

const caches = new WeakMap<GitHubClient, LruCache<string, Entry>>();

function cacheFor(client: GitHubClient): LruCache<string, Entry> {
  let cache = caches.get(client);
  if (!cache) {
    cache = new LruCache<string, Entry>({ maxEntries: MAX_ENTRIES });
    caches.set(client, cache);
  }
  return cache;
}

function keyOf(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export function rememberMetadata(
  client: GitHubClient,
  owner: string,
  repo: string,
  summary: RepositorySummary,
): void {
  cacheFor(client).set(keyOf(owner, repo), {
    summary: structuredClone(summary),
    loadedAt: Date.now(),
  });
}

/** A copy of the metadata loaded at most `maxAgeMs` ago, or undefined. */
export function recentMetadata(
  client: GitHubClient,
  owner: string,
  repo: string,
  maxAgeMs: number,
): RepositorySummary | undefined {
  const entry = cacheFor(client).get(keyOf(owner, repo));
  if (!entry || Date.now() - entry.loadedAt > maxAgeMs) return undefined;
  return structuredClone(entry.summary);
}
