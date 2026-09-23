import type { RateLimitSnapshot } from "@/graph/model/types";
import { raceWithSignal, throwIfAborted } from "@/github/async";
import type { GitHubClient } from "@/github/client";
import { ExpiringCache } from "@/github/lru-cache";
import { sanitizeRepositoryPath } from "@/github/paths";
import { assertOwner, assertRepoName, assertUserRef } from "@/github/validation";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import type {
  HistoryOptions,
  ReadFileOptions,
  RepositorySource,
  SourceCapabilities,
  SourceCommit,
  SourceCommitCountBucket,
  SourceCommitDetails,
  SourceContributor,
  SourceFileActivity,
  SourceFileResult,
  SourceSnapshot,
} from "@/sources/types";
import { getCommitCounts, getFileActivity } from "./graphql-history";
import { getCommitDetails, listCommits, listContributors } from "./history";
import { coordinatesOf, resolveSnapshot } from "./snapshot";
import { listRepositoryTree, type GitHubSourceTree } from "./tree";

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  /** Branch, tag or SHA to analyse; the default branch when omitted. */
  ref?: string;
  client: GitHubClient;
  /** Stop listing the tree after this many entries (default `DEFAULT_LIMITS.maxTreeEntries`). */
  maxTreeEntries?: number;
}

/** Resolved snapshots are reused for this long (per client, i.e. per process for the shared client). */
export const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_CACHE_SIZE = 500;
const snapshotCaches = new WeakMap<GitHubClient, ExpiringCache<SourceSnapshot>>();

function snapshotCacheFor(client: GitHubClient): ExpiringCache<SourceSnapshot> {
  let cache = snapshotCaches.get(client);
  if (!cache) {
    cache = new ExpiringCache<SourceSnapshot>({ maxEntries: SNAPSHOT_CACHE_SIZE });
    snapshotCaches.set(client, cache);
  }
  return cache;
}

/**
 * `RepositorySource` backed by the public GitHub API.
 *
 * The constructor validates owner, repository and ref and throws
 * `SourceError("INVALID_REPOSITORY")` for anything malformed, so no request is
 * ever built from unvalidated input. Private repositories are rejected even
 * when the configured token could read them.
 */
export class GitHubSource implements RepositorySource {
  readonly provider = "github" as const;
  readonly capabilities: SourceCapabilities;
  readonly #client: GitHubClient;
  readonly #owner: string;
  readonly #repo: string;
  readonly #ref: string | undefined;
  readonly #maxTreeEntries: number;

  constructor(options: GitHubSourceOptions) {
    this.#owner = assertOwner(options.owner);
    this.#repo = assertRepoName(options.repo);
    this.#ref = options.ref === undefined ? undefined : assertUserRef(options.ref);
    this.#client = options.client;
    this.#maxTreeEntries = Math.max(
      1,
      Math.floor(options.maxTreeEntries ?? DEFAULT_LIMITS.maxTreeEntries),
    );
    const graphql = this.#client.hasToken();
    this.capabilities = { fileHistory: graphql, commitCounts: graphql };
  }

  async getSnapshot(signal?: AbortSignal): Promise<SourceSnapshot> {
    throwIfAborted(signal);
    const key = `${this.#owner.toLowerCase()}/${this.#repo.toLowerCase()}#${this.#ref ?? ""}`;
    // The shared load runs without the caller's signal so one caller aborting
    // never fails another; each caller still stops waiting on its own abort.
    const shared = snapshotCacheFor(this.#client).load(key, SNAPSHOT_TTL_MS, () =>
      resolveSnapshot(this.#client, { owner: this.#owner, repo: this.#repo, ref: this.#ref }),
    );
    return structuredClone(await raceWithSignal(shared, signal));
  }

  async listTree(snapshot: SourceSnapshot, signal?: AbortSignal): Promise<GitHubSourceTree> {
    return listRepositoryTree(this.#client, coordinatesOf(snapshot), {
      maxTreeEntries: this.#maxTreeEntries,
      maxPathLength: this.#client.maxPathLength,
      signal,
    });
  }

  async readFile(
    snapshot: SourceSnapshot,
    path: string,
    options: ReadFileOptions,
  ): Promise<SourceFileResult> {
    const { owner, repo, sha } = coordinatesOf(snapshot);
    throwIfAborted(options.signal);
    // A path that cannot exist in a sanitized tree is reported as missing.
    if (sanitizeRepositoryPath(path, this.#client.maxPathLength) === null)
      return { kind: "missing" };
    return this.#client.getRawFile(owner, repo, sha, path, options);
  }

  async listCommits(snapshot: SourceSnapshot, options: HistoryOptions): Promise<SourceCommit[]> {
    return listCommits(this.#client, coordinatesOf(snapshot), options.maxCommits, options.signal);
  }

  async getCommitDetails(
    snapshot: SourceSnapshot,
    sha: string,
    signal?: AbortSignal,
  ): Promise<SourceCommitDetails> {
    return getCommitDetails(
      this.#client,
      coordinatesOf(snapshot),
      sha,
      this.#client.maxPathLength,
      signal,
    );
  }

  async listContributors(
    snapshot: SourceSnapshot,
    signal?: AbortSignal,
  ): Promise<SourceContributor[]> {
    return listContributors(this.#client, coordinatesOf(snapshot), signal);
  }

  async getFileActivity(
    snapshot: SourceSnapshot,
    paths: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, SourceFileActivity>> {
    return getFileActivity(
      this.#client,
      coordinatesOf(snapshot),
      paths,
      this.#client.maxPathLength,
      signal,
    );
  }

  async getCommitCounts(
    snapshot: SourceSnapshot,
    ranges: Array<{ start: string; end: string }>,
    signal?: AbortSignal,
  ): Promise<SourceCommitCountBucket[]> {
    return getCommitCounts(this.#client, coordinatesOf(snapshot), ranges, signal);
  }

  getRateLimit(): RateLimitSnapshot | undefined {
    return this.#client.getRateLimit();
  }
}
