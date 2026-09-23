import { GitHubClient, type GitHubClientOptions } from "@/github/client";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { GitHubSource, type GitHubSourceOptions } from "./github-source";
import type { RepositorySummary } from "./snapshot";
import { fetchRepositorySummaryWith } from "./summary";

/**
 * Server-side entry point of the GitHub provider.
 *
 * Import this module from route handlers, server components and metadata
 * functions only: it reads `GITHUB_TOKEN` from the environment. The token is
 * held in a private field of the shared client and is never returned, logged
 * or attached to errors.
 */

export { GitHubSource, GitHubClient, type GitHubSourceOptions, type GitHubClientOptions };
export { GitHubApiError } from "@/github/errors";
export type { GitHubSourceTree } from "./tree";
export type { RepositorySummary };

const SHARED_CLIENT_KEY = Symbol.for("codeverse.github.sharedClient");

type SharedClientHolder = { [SHARED_CLIENT_KEY]?: GitHubClient };

/**
 * Process-wide client (stored on `globalThis` so development hot reloads keep
 * one instance). Sharing it shares the ETag cache, snapshot/summary caches and
 * rate-limit state across all requests.
 */
export function getSharedGitHubClient(): GitHubClient {
  const holder = globalThis as typeof globalThis & SharedClientHolder;
  let client = holder[SHARED_CLIENT_KEY];
  if (!client) {
    const token = process.env.GITHUB_TOKEN?.trim();
    client = new GitHubClient({
      token: token ? token : undefined,
      requestTimeoutMs: DEFAULT_LIMITS.requestTimeoutMs,
      maxPathLength: DEFAULT_LIMITS.maxPathLength,
      absoluteMaxFileBytes: DEFAULT_LIMITS.absoluteMaxFileBytes,
    });
    holder[SHARED_CLIENT_KEY] = client;
  }
  return client;
}

/** Creates a source for one repository using the shared client. Throws INVALID_REPOSITORY for malformed input. */
export function createGitHubSource(ref: {
  owner: string;
  repo: string;
  ref?: string;
}): GitHubSource {
  return new GitHubSource({
    owner: ref.owner,
    repo: ref.repo,
    ref: ref.ref,
    client: getSharedGitHubClient(),
  });
}

/**
 * Public repository metadata (no ref/commit) for page metadata and OG images:
 * one ETag-cached REST call behind a short in-process TTL cache. Throws
 * `SourceError`; private repositories are rejected with PRIVATE_OR_INACCESSIBLE.
 */
export async function fetchRepositorySummary(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<RepositorySummary> {
  return fetchRepositorySummaryWith(getSharedGitHubClient(), owner, repo, signal);
}
