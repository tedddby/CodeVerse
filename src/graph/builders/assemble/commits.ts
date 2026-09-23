import { fileId } from "@/graph/model/ids";
import type { CommitNode, RepositoryInfo, Timeline, TimelineBucket } from "@/graph/model/types";
import { compareStrings, compareTuples } from "../sort";
import { bucketCommits } from "../timeline";
import type { HistoryInput } from "./types";

/**
 * Commit normalization: merging listed and detailed commits, CommitNodes and
 * the timeline. Every value comes from the provider and is treated as untrusted.
 */

const MAX_MESSAGE_LENGTH = 200;

export interface CommitRecord {
  sha: string;
  message: string;
  authorName: string;
  authorLogin?: string;
  authorAvatarUrl?: string;
  /** ISO-8601 UTC when parseable, else the raw provider value. */
  date: string;
  /** Epoch milliseconds, NaN when the date is invalid. */
  time: number;
  url: string;
  details?: { additions?: number; deletions?: number; files: string[] };
}

/** Normalizes a date to ISO-8601 UTC, or returns null when it cannot be parsed. */
export function isoDate(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function nonNegativeInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/** First line of a commit message, trimmed and capped at 200 characters. */
export function firstLine(message: string): string {
  const line = (message.split(/\r?\n/)[0] ?? "").trim();
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : line;
}

/** Merges listed commits and detailed commits by SHA; newest first, undated last. */
export function mergeCommits(history: HistoryInput): CommitRecord[] {
  const bySha = new Map<string, CommitRecord>();
  const add = (
    commit: HistoryInput["commits"][number],
    details?: HistoryInput["details"][number],
  ): void => {
    const date = isoDate(commit.date);
    const record: CommitRecord = bySha.get(commit.sha) ?? {
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorLogin: commit.authorLogin,
      authorAvatarUrl: commit.authorAvatarUrl,
      date: date ?? commit.date,
      time: date ? Date.parse(date) : Number.NaN,
      url: commit.url,
    };
    if (details) {
      record.details = {
        additions: nonNegativeInteger(details.additions),
        deletions: nonNegativeInteger(details.deletions),
        files: [...new Set(details.files)],
      };
    }
    bySha.set(commit.sha, record);
  };
  const compareSha = (a: { sha: string }, b: { sha: string }) => compareStrings(a.sha, b.sha);
  for (const commit of [...history.commits].sort(compareSha)) add(commit);
  for (const details of [...history.details].sort(compareSha)) add(details, details);

  const key = (record: CommitRecord): Array<number | string> => {
    const undated = Number.isNaN(record.time);
    return [undated ? 1 : 0, undated ? 0 : -record.time, record.sha];
  };
  return [...bySha.values()].sort((a, b) => compareTuples(key(a), key(b)));
}

/** Commit URLs are only kept when they point at the repository's own host. */
function commitUrl(record: CommitRecord, repository: RepositoryInfo): string {
  let origin: string | null = null;
  try {
    origin = new URL(repository.url).origin;
  } catch {
    origin = null;
  }
  if (origin && origin.startsWith("https://") && record.url.startsWith(`${origin}/`)) {
    return record.url;
  }
  return `${repository.url}/commit/${encodeURIComponent(record.sha)}`;
}

export function buildCommitNodes(
  records: readonly CommitRecord[],
  authorIdOf: (record: CommitRecord) => string | undefined,
  graphPaths: ReadonlySet<string>,
  repository: RepositoryInfo,
): CommitNode[] {
  return records.map((record) => {
    const node: CommitNode = {
      sha: record.sha,
      message: firstLine(record.message),
      authorName: record.authorName.trim(),
      date: record.date,
      url: commitUrl(record, repository),
    };
    const authorId = authorIdOf(record);
    if (authorId !== undefined) node.authorId = authorId;
    if (record.details) {
      if (record.details.additions !== undefined) node.additions = record.details.additions;
      if (record.details.deletions !== undefined) node.deletions = record.details.deletions;
      node.fileIds = record.details.files
        .filter((path) => graphPaths.has(path))
        .sort(compareStrings)
        .map((path) => fileId(path));
      node.changedFileCount = record.details.files.length;
    }
    return node;
  });
}

/**
 * Exact commit counts become a "full-history" timeline; otherwise the sampled
 * commits are bucketed. Without history the timeline is empty.
 */
export function buildTimeline(
  history: HistoryInput | null,
  records: readonly CommitRecord[],
): Timeline {
  let granularity: Timeline["granularity"] = "week";
  let coverage: Timeline["coverage"] = "sampled";
  let buckets: TimelineBucket[] = [];
  if (history?.commitCounts) {
    coverage = "full-history";
    granularity = history.commitCounts.granularity;
    buckets = history.commitCounts.buckets
      .map((bucket) => ({
        start: isoDate(bucket.start),
        end: isoDate(bucket.end),
        commits: nonNegativeInteger(bucket.commits) ?? 0,
      }))
      .filter((bucket): bucket is TimelineBucket => bucket.start !== null && bucket.end !== null)
      .sort((a, b) => compareStrings(a.start, b.start));
  } else if (history) {
    const dated = records.filter((record) => !Number.isNaN(record.time));
    const sampled = bucketCommits(dated.map((record) => record.date));
    granularity = sampled.granularity;
    buckets = sampled.buckets;
  }
  const timeline: Timeline = { granularity, coverage, buckets };
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (first && last) {
    timeline.start = first.start;
    timeline.end = last.end;
  }
  return timeline;
}
