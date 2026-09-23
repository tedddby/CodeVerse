import type {
  SourceCommit,
  SourceCommitCountBucket,
  SourceCommitDetails,
  SourceContributor,
  SourceFileActivity,
} from "@/sources/types";

/**
 * Deterministic history derivations for `MemorySource`. When a spec provides
 * commits but no explicit contributors, file activity or commit counts, these
 * are derived from the commits so local ingestion (a folder or archive with a
 * Git log) produces consistent data without a provider API.
 */

/** Strips detail-only fields so `listCommits` returns plain `SourceCommit`s. */
export function toSourceCommit(commit: SourceCommitDetails): SourceCommit {
  const result: SourceCommit = {
    sha: commit.sha,
    message: commit.message,
    authorName: commit.authorName,
    date: commit.date,
    url: commit.url,
  };
  if (commit.authorLogin !== undefined) result.authorLogin = commit.authorLogin;
  if (commit.authorAvatarUrl !== undefined) result.authorAvatarUrl = commit.authorAvatarUrl;
  return result;
}

/** Groups commits by login (case-insensitive) or, failing that, by author name. */
export function deriveContributors(
  commits: readonly SourceCommitDetails[],
  profileUrlFor: (login: string) => string | undefined,
): SourceContributor[] {
  const byKey = new Map<string, SourceContributor>();
  for (const commit of commits) {
    const key = commit.authorLogin
      ? `login:${commit.authorLogin.toLowerCase()}`
      : `name:${commit.authorName.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.contributions += 1;
      continue;
    }
    const contributor: SourceContributor = {
      name: commit.authorLogin ?? commit.authorName,
      contributions: 1,
    };
    if (commit.authorLogin) {
      contributor.login = commit.authorLogin;
      const profileUrl = profileUrlFor(commit.authorLogin);
      if (profileUrl) contributor.profileUrl = profileUrl;
    }
    if (commit.authorAvatarUrl) contributor.avatarUrl = commit.authorAvatarUrl;
    byKey.set(key, contributor);
  }
  return sortContributors([...byKey.values()]);
}

/** Most contributions first; ties keep their original order (stable sort). */
export function sortContributors(contributors: SourceContributor[]): SourceContributor[] {
  return contributors.sort((a, b) => b.contributions - a.contributions);
}

/** Last commit (newest first input) touching each path, from commit file lists. */
export function deriveFileActivity(
  commits: readonly SourceCommitDetails[],
  paths: ReadonlySet<string>,
): Map<string, SourceFileActivity> {
  const activity = new Map<string, SourceFileActivity>();
  for (const commit of commits) {
    for (const path of commit.files) {
      if (!paths.has(path) || activity.has(path)) continue;
      const entry: SourceFileActivity = {
        lastModified: commit.date,
        authorName: commit.authorName,
      };
      if (commit.authorLogin) entry.authorLogin = commit.authorLogin;
      activity.set(path, entry);
    }
    if (activity.size === paths.size) break;
  }
  return activity;
}

/**
 * Commit counts per range: an explicitly specified bucket with the same
 * boundaries wins, otherwise commits dated within [start, end) are counted.
 */
export function deriveCommitCounts(
  ranges: ReadonlyArray<{ start: string; end: string }>,
  commits: readonly SourceCommitDetails[],
  explicit: readonly SourceCommitCountBucket[] = [],
): SourceCommitCountBucket[] {
  const times = commits
    .map((commit) => Date.parse(commit.date))
    .filter((time) => !Number.isNaN(time));
  return ranges.map((range) => {
    const match = explicit.find(
      (bucket) => bucket.start === range.start && bucket.end === range.end,
    );
    if (match) return { start: range.start, end: range.end, commits: match.commits };
    const start = Date.parse(range.start);
    const end = Date.parse(range.end);
    const commitsInRange =
      Number.isNaN(start) || Number.isNaN(end)
        ? 0
        : times.filter((time) => time >= start && time < end).length;
    return { start: range.start, end: range.end, commits: commitsInRange };
  });
}

/**
 * Deterministic 40-hex "commit SHA" for in-memory content: five FNV-1a
 * variants over the given parts. Not cryptographic; it only needs to change
 * whenever the content changes so it can serve as a cache key.
 */
export function contentSha(parts: readonly string[]): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const encoder = new TextEncoder();
  const hashes = seeds.map((seed) => seed >>> 0);
  for (const part of parts) {
    const bytes = encoder.encode(`${part}\u0000`);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      let hash = hashes[lane] as number;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193 + lane * 2) >>> 0;
      }
      hashes[lane] = hash;
    }
  }
  return hashes.map((hash) => hash.toString(16).padStart(8, "0")).join("");
}
