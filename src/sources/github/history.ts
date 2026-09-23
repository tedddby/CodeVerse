import type { GitHubClient } from "@/github/client";
import { GitHubApiError, invalidResponse } from "@/github/errors";
import { sanitizeRepositoryPath } from "@/github/paths";
import {
  commitDetailsSchema,
  commitListSchema,
  contributorListSchema,
  type GitHubCommit,
  type GitHubContributor,
} from "@/github/schemas";
import { cleanSingleLine, firstLine, normalizeIsoDate } from "@/github/text";
import { assertCommitSha, isCommitSha, repoApiPath } from "@/github/validation";
import type { SourceCommit, SourceCommitDetails, SourceContributor } from "@/sources/types";
import type { RepositoryCoordinates } from "./snapshot";

/**
 * REST history endpoints: commit listing, commit details and contributors.
 * Every value is re-validated and sanitized before it enters the model.
 */

const PAGE_SIZE = 100;
const MAX_MESSAGE_LENGTH = 300;
const MAX_NAME_LENGTH = 200;
const AVATAR_ORIGIN = "https://avatars.githubusercontent.com";
/** GitHub logins (legacy accounts may contain repeated/trailing hyphens) plus app bots. */
const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
const CONTRIBUTORS_TOO_LARGE = /too large to list contributors/i;

/** Keeps avatar URLs only when they point at GitHub's avatar CDN. */
export function allowlistAvatarUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || !value.startsWith(`${AVATAR_ORIGIN}/`) || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.origin === AVATAR_ORIGIN && url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the login when it is a plausible GitHub account/app login. */
export function validLogin(value: string | null | undefined): string | undefined {
  return typeof value === "string" && LOGIN_PATTERN.test(value) ? value : undefined;
}

/** Canonical profile URL built from the login, never taken from the payload. */
export function profileUrlFor(login: string): string {
  const bot = /^(.*)\[bot\]$/.exec(login);
  return bot?.[1]
    ? `https://github.com/apps/${encodeURIComponent(bot[1])}`
    : `https://github.com/${encodeURIComponent(login)}`;
}

function commitUrl(
  coordinates: RepositoryCoordinates,
  sha: string,
  htmlUrl: string | null | undefined,
): string {
  if (typeof htmlUrl === "string" && htmlUrl.length <= 2_048) {
    try {
      const url = new URL(htmlUrl);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
      // Fall through to the constructed URL.
    }
  }
  return `https://github.com/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}/commit/${sha}`;
}

/** Maps a REST commit; undefined when the payload lacks a valid SHA or date. */
export function mapCommit(
  coordinates: RepositoryCoordinates,
  commit: GitHubCommit,
): SourceCommit | undefined {
  if (!isCommitSha(commit.sha)) return undefined;
  const date =
    normalizeIsoDate(commit.commit.author?.date) ?? normalizeIsoDate(commit.commit.committer?.date);
  if (!date) return undefined;
  const sha = commit.sha.toLowerCase();
  const login = validLogin(commit.author?.login);
  const gitName = commit.commit.author?.name
    ? cleanSingleLine(commit.commit.author.name, MAX_NAME_LENGTH)
    : "";
  const mapped: SourceCommit = {
    sha,
    message: firstLine(commit.commit.message, MAX_MESSAGE_LENGTH),
    authorName: gitName || login || "Unknown",
    date,
    url: commitUrl(coordinates, sha, commit.html_url),
  };
  if (login) mapped.authorLogin = login;
  const avatar = allowlistAvatarUrl(commit.author?.avatar_url);
  if (avatar) mapped.authorAvatarUrl = avatar;
  return mapped;
}

/** Most recent commits reachable from the snapshot commit, newest first. */
export async function listCommits(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  maxCommits: number,
  signal?: AbortSignal,
): Promise<SourceCommit[]> {
  const limit = Number.isFinite(maxCommits) ? Math.max(0, Math.floor(maxCommits)) : 0;
  const commits: SourceCommit[] = [];
  const seen = new Set<string>();
  for (let page = 1; commits.length < limit; page += 1) {
    const batch = await client.getJson(
      `${repoApiPath(coordinates.owner, coordinates.repo)}/commits`,
      commitListSchema,
      {
        signal,
        useEtag: true,
        query: { sha: coordinates.sha, per_page: PAGE_SIZE, page },
      },
    );
    for (const raw of batch) {
      const commit = mapCommit(coordinates, raw);
      if (!commit || seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      commits.push(commit);
      if (commits.length >= limit) break;
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return commits;
}

/**
 * Changed files and line stats for one commit (first page of files, i.e. up to
 * 300). Not ETag-cached: the payload embeds patches and would crowd out the
 * small metadata responses the cache exists for.
 */
export async function getCommitDetails(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  sha: string,
  maxPathLength: number,
  signal?: AbortSignal,
): Promise<SourceCommitDetails> {
  const commitSha = assertCommitSha(sha);
  const raw = await client.getJson(
    `${repoApiPath(coordinates.owner, coordinates.repo)}/commits/${commitSha}`,
    commitDetailsSchema,
    { signal },
  );
  const commit = mapCommit(coordinates, raw);
  if (!commit) {
    throw invalidResponse("GitHub returned an invalid commit.", 200);
  }
  const files: string[] = [];
  const seen = new Set<string>();
  for (const file of raw.files ?? []) {
    const path = sanitizeRepositoryPath(file.filename, maxPathLength);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    files.push(path);
  }
  const details: SourceCommitDetails = { ...commit, files };
  if (raw.stats?.additions !== undefined) details.additions = raw.stats.additions;
  if (raw.stats?.deletions !== undefined) details.deletions = raw.stats.deletions;
  return details;
}

function mapContributor(raw: GitHubContributor): SourceContributor | undefined {
  const login = validLogin(raw.login);
  if (!login) return undefined;
  const contributor: SourceContributor = {
    login,
    name: login,
    profileUrl: profileUrlFor(login),
    contributions: raw.contributions,
  };
  const avatar = allowlistAvatarUrl(raw.avatar_url);
  if (avatar) contributor.avatarUrl = avatar;
  return contributor;
}

/**
 * Top contributors (first page, most contributions first). Anonymous
 * contributors are never requested, so no e-mail address is ever collected.
 * GitHub answers 204 while statistics are computed and 403 for histories that
 * are too large to list; both mean "no contributor data", not an error.
 */
export async function listContributors(
  client: GitHubClient,
  coordinates: RepositoryCoordinates,
  signal?: AbortSignal,
): Promise<SourceContributor[]> {
  let raw: GitHubContributor[] | null;
  try {
    raw = await client.getJson(
      `${repoApiPath(coordinates.owner, coordinates.repo)}/contributors`,
      contributorListSchema,
      {
        signal,
        useEtag: true,
        query: { per_page: PAGE_SIZE },
      },
    );
  } catch (error) {
    if (
      error instanceof GitHubApiError &&
      error.status === 403 &&
      error.code === "PRIVATE_OR_INACCESSIBLE" &&
      error.upstreamMessage !== undefined &&
      CONTRIBUTORS_TOO_LARGE.test(error.upstreamMessage)
    ) {
      return [];
    }
    throw error;
  }
  const contributors: SourceContributor[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    const contributor = mapContributor(entry);
    if (!contributor?.login || seen.has(contributor.login.toLowerCase())) continue;
    seen.add(contributor.login.toLowerCase());
    contributors.push(contributor);
  }
  return contributors.sort((a, b) => b.contributions - a.contributions);
}
