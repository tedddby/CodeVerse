import type { RepositoryInfo } from "@/graph/model/types";
import type { GitHubClient } from "@/github/client";
import { invalidResponse } from "@/github/errors";
import { repositorySchema, type GitHubRepository } from "@/github/schemas";
import { cleanSingleLine, normalizeIsoDate } from "@/github/text";
import {
  assertCommitSha,
  assertOwner,
  assertRepoName,
  encodeRef,
  isCommitSha,
  isSafeApiRef,
  repoApiPath,
} from "@/github/validation";
import { isValidOwner, isValidRepoName } from "@/lib/validation/repository-url";
import { SourceError, isSourceError, type SourceSnapshot } from "@/sources/types";

/** Repository metadata without the analysed ref/commit (what page metadata and OG images need). */
export type RepositorySummary = Omit<RepositoryInfo, "ref" | "commitSha">;

/** GitHub topic format: lower-case alphanumerics and hyphens, at most 50 characters. */
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const MAX_TOPICS = 20;
const MAX_DESCRIPTION_LENGTH = 1_000;

function httpsUrl(value: string | null | undefined, allowHttp = false): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return undefined;
  const candidate = allowHttp && !/^[a-z][a-z0-9+.-]*:/i.test(value) ? `https://${value}` : value;
  try {
    const url = new URL(candidate);
    const allowed = url.protocol === "https:" || (allowHttp && url.protocol === "http:");
    return allowed && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function optionalText(value: string | null | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = cleanSingleLine(value, maxLength);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Maps the REST repository payload to the provider-agnostic model.
 * Throws PRIVATE_OR_INACCESSIBLE for anything that is not public: a server
 * token with private access must never expose private repositories.
 */
export function mapRepository(data: GitHubRepository): RepositorySummary {
  if (data.private || (data.visibility !== undefined && data.visibility !== "public")) {
    throw new SourceError(
      "PRIVATE_OR_INACCESSIBLE",
      "CodeVerse only explores public repositories.",
      { status: 200 },
    );
  }
  const [owner, name, ...rest] = data.full_name.split("/");
  if (!owner || !name || rest.length > 0 || !isValidOwner(owner) || !isValidRepoName(name)) {
    throw invalidResponse("GitHub returned an invalid repository name.");
  }
  if (!isSafeApiRef(data.default_branch)) {
    throw invalidResponse("GitHub returned an invalid default branch name.");
  }
  const fullName = `${owner}/${name}`;
  const summary: RepositorySummary = {
    id: `github:${fullName}`,
    provider: "github",
    owner,
    name,
    fullName,
    url: httpsUrl(data.html_url) ?? `https://github.com/${fullName}`,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    forks: data.forks_count,
    topics: (data.topics ?? []).filter((topic) => TOPIC_PATTERN.test(topic)).slice(0, MAX_TOPICS),
  };
  const description = optionalText(data.description, MAX_DESCRIPTION_LENGTH);
  if (description) summary.description = description;
  const watchers = data.subscribers_count ?? data.watchers_count;
  if (watchers !== undefined) summary.watchers = watchers;
  if (data.open_issues_count !== undefined) summary.openIssues = data.open_issues_count;
  const language = optionalText(data.language, 100);
  if (language) summary.language = language;
  const spdx = optionalText(data.license?.spdx_id, 100);
  if (spdx && spdx !== "NOASSERTION") summary.license = spdx;
  const homepage = httpsUrl(data.homepage?.trim(), true);
  if (homepage) summary.homepage = homepage;
  const createdAt = normalizeIsoDate(data.created_at);
  if (createdAt) summary.createdAt = createdAt;
  const pushedAt = normalizeIsoDate(data.pushed_at);
  if (pushedAt) summary.pushedAt = pushedAt;
  if (data.size !== undefined) summary.sizeKb = data.size;
  if (data.fork !== undefined) summary.isFork = data.fork;
  if (data.archived !== undefined) summary.isArchived = data.archived;
  return summary;
}

/** One ETag-cached REST call: GET /repos/{owner}/{repo}. */
export async function fetchRepositoryMetadata(
  client: GitHubClient,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<RepositorySummary> {
  const data = await client.getJson(repoApiPath(owner, repo), repositorySchema, {
    signal,
    useEtag: true,
  });
  return mapRepository(data);
}

/**
 * Resolves a branch, tag or SHA to a full commit SHA using the lightweight
 * `application/vnd.github.sha` representation.
 *
 * - 404/422 → REF_NOT_FOUND when the ref was requested by the user,
 *   EMPTY_REPOSITORY when resolving the default branch;
 * - 409 → EMPTY_REPOSITORY (GitHub's "Git Repository is empty").
 */
export async function resolveCommitSha(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  refRequested: boolean,
  signal?: AbortSignal,
): Promise<string> {
  let text: string;
  try {
    text = await client.getText(`${repoApiPath(owner, repo)}/commits/${encodeRef(ref)}`, {
      accept: "application/vnd.github.sha",
      useEtag: true,
      signal,
    });
  } catch (error) {
    if (isSourceError(error) && (error.code === "NOT_FOUND" || error.status === 422)) {
      throw refRequested
        ? new SourceError("REF_NOT_FOUND", "The requested branch, tag or commit does not exist.", {
            status: error.status,
          })
        : new SourceError("EMPTY_REPOSITORY", "The default branch has no commits.", {
            status: error.status,
          });
    }
    throw error;
  }
  const sha = text.trim();
  if (!isCommitSha(sha)) throw invalidResponse("GitHub returned an invalid commit SHA.");
  return sha.toLowerCase();
}

export interface SnapshotRequest {
  owner: string;
  repo: string;
  /** User-requested branch/tag/SHA; the default branch when omitted. */
  ref?: string;
}

/** Fetches metadata, enforces public visibility and pins the exact commit. */
export async function resolveSnapshot(
  client: GitHubClient,
  request: SnapshotRequest,
  signal?: AbortSignal,
): Promise<SourceSnapshot> {
  const summary = await fetchRepositoryMetadata(client, request.owner, request.repo, signal);
  const ref = request.ref ?? summary.defaultBranch;
  // Use the canonical names from the API so renamed repositories do not redirect.
  const commitSha = await resolveCommitSha(
    client,
    summary.owner,
    summary.name,
    ref,
    request.ref !== undefined,
    signal,
  );
  return { repository: { ...summary, ref, commitSha } };
}

export interface RepositoryCoordinates {
  owner: string;
  repo: string;
  sha: string;
}

/** Extracts and re-validates the URL components of a snapshot. */
export function coordinatesOf(snapshot: SourceSnapshot): RepositoryCoordinates {
  const { owner, name, commitSha } = snapshot.repository;
  return {
    owner: assertOwner(owner),
    repo: assertRepoName(name),
    sha: assertCommitSha(commitSha),
  };
}
