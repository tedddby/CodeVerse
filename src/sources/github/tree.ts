import type { GitHubClient } from "@/github/client";
import { mapWithConcurrency } from "@/github/async";
import { sanitizeRepositoryPath } from "@/github/paths";
import { treeSchema, type GitHubTree, type GitHubTreeEntry } from "@/github/schemas";
import { isCommitSha, repoApiPath } from "@/github/validation";
import { isSourceError, type SourceTree, type SourceTreeEntry } from "@/sources/types";
import type { RepositoryCoordinates } from "./snapshot";

/**
 * Recursive tree listing with truncation recovery.
 *
 * GitHub truncates recursive tree responses at ~100k entries / 7 MB. When that
 * happens (and quota allows), the root is listed non-recursively and every
 * top-level directory is fetched as its own recursive subtree. Entries from the
 * original truncated response fill in any directory that could not be
 * recovered, so recovery never yields fewer entries than the first response.
 */

/** `SourceTree` plus the number of entries dropped by path sanitization. */
export interface GitHubSourceTree extends SourceTree {
  rejectedEntries: number;
}

export interface TreeListingOptions {
  maxTreeEntries: number;
  maxPathLength: number;
  signal?: AbortSignal;
}

/** Recovery only runs while more than this many REST requests remain. */
export const RECOVERY_MIN_REMAINING = 50;
/** Upper bound on per-directory subtree requests during recovery. */
export const RECOVERY_MAX_SUBTREES = 60;
const RECOVERY_CONCURRENCY = 4;

class TreeCollector {
  readonly #entries = new Map<string, SourceTreeEntry>();
  #rejected = 0;
  #limitReached = false;

  constructor(
    readonly maxEntries: number,
    readonly maxPathLength: number,
  ) {}

  /** Adds provider entries whose paths are relative to `prefix` ("" for the root). */
  addAll(entries: readonly GitHubTreeEntry[], prefix: string): void {
    for (const entry of entries) this.#add(entry, prefix);
  }

  #add(entry: GitHubTreeEntry, prefix: string): void {
    let type: SourceTreeEntry["type"];
    if (entry.type === "blob") type = entry.mode === "120000" ? "symlink" : "file";
    else if (entry.type === "commit") type = "submodule";
    else return; // "tree" entries are implied by file paths; unknown types are ignored.
    const path = sanitizeRepositoryPath(
      prefix ? `${prefix}/${entry.path}` : entry.path,
      this.maxPathLength,
    );
    if (path === null) {
      this.#rejected += 1;
      return;
    }
    if (this.#entries.has(path)) return;
    if (this.#entries.size >= this.maxEntries) {
      this.#limitReached = true;
      return;
    }
    this.#entries.set(path, { path, type, size: type === "submodule" ? 0 : (entry.size ?? 0) });
  }

  finish(incomplete: boolean): GitHubSourceTree {
    const entries = [...this.#entries.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    return {
      entries,
      truncated: incomplete || this.#limitReached,
      rejectedEntries: this.#rejected,
    };
  }
}

function fetchTree(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  treeSha: string,
  recursive: boolean,
  signal?: AbortSignal,
): Promise<GitHubTree> {
  return client.getJson(
    `${repoApiPath(coordinates.owner, coordinates.repo)}/git/trees/${treeSha.toLowerCase()}`,
    treeSchema,
    { signal, query: recursive ? { recursive: 1 } : undefined },
  );
}

function isCancellation(error: unknown): boolean {
  return isSourceError(error) && (error.code === "ABORTED" || error.code === "TIMEOUT");
}

/** Lists every file of the snapshot commit, recovering from GitHub's truncation when possible. */
export async function listRepositoryTree(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  options: TreeListingOptions,
): Promise<GitHubSourceTree> {
  const initial = await fetchTree(client, coordinates, coordinates.sha, true, options.signal);
  const collector = new TreeCollector(options.maxTreeEntries, options.maxPathLength);
  if (!initial.truncated) {
    collector.addAll(initial.tree, "");
    return collector.finish(false);
  }

  let complete = false;
  if (client.hasCoreQuota(RECOVERY_MIN_REMAINING)) {
    complete = await recoverTruncatedTree(client, coordinates, collector, options.signal);
  }
  // Fill directories that were not (fully) recovered from the original listing.
  collector.addAll(initial.tree, "");
  return collector.finish(!complete);
}

/** Returns true when every top-level directory was recovered without truncation. */
async function recoverTruncatedTree(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  collector: TreeCollector,
  signal?: AbortSignal,
): Promise<boolean> {
  let root: GitHubTree;
  try {
    root = await fetchTree(client, coordinates, coordinates.sha, false, signal);
  } catch (error) {
    if (isCancellation(error)) throw error;
    return false;
  }
  collector.addAll(
    root.tree.filter((entry) => entry.type !== "tree"),
    "",
  );
  const directories = root.tree.filter((entry) => entry.type === "tree");
  let complete = !root.truncated && directories.length <= RECOVERY_MAX_SUBTREES;
  let rateLimited = false;

  await mapWithConcurrency(
    directories.slice(0, RECOVERY_MAX_SUBTREES),
    RECOVERY_CONCURRENCY,
    async (directory) => {
      const prefix = sanitizeRepositoryPath(directory.path, collector.maxPathLength);
      const sha = directory.sha;
      if (rateLimited || prefix === null || prefix.includes("/") || !sha || !isCommitSha(sha)) {
        complete = false;
        return;
      }
      if (!client.hasCoreQuota(RECOVERY_MIN_REMAINING)) {
        complete = false;
        return;
      }
      try {
        const subtree = await fetchTree(client, coordinates, sha, true, signal);
        if (subtree.truncated) complete = false;
        collector.addAll(subtree.tree, prefix);
      } catch (error) {
        if (isCancellation(error)) throw error;
        complete = false;
        if (isSourceError(error) && error.code === "RATE_LIMITED") rateLimited = true;
      }
    },
  );
  return complete;
}
