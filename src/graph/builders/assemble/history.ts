import { contributorIdFromLogin, contributorIdFromName, fileId } from "@/graph/model/ids";
import type {
  CommitNode,
  ContributorNode,
  FileActivity,
  HistorySummary,
  RepositoryInfo,
  Timeline,
} from "@/graph/model/types";
import { compareStrings, compareTuples } from "../sort";
import {
  buildCommitNodes,
  buildTimeline,
  isoDate,
  mergeCommits,
  nonNegativeInteger,
  type CommitRecord,
} from "./commits";
import type { HistoryInput } from "./types";

/**
 * History assembly: contributors, per-file activity, commits and the timeline.
 *
 * Author identity: a provider login always wins ("user:<login>"); otherwise the
 * normalized author name ("author:<name>"). Contributors are capped, and every
 * reference to a contributor (commit authors, file activity) is guaranteed to
 * point at a ContributorNode of the output.
 */

export const MAX_CONTRIBUTORS = 200;
const MAX_FILE_CONTRIBUTORS = 10;
/** Only avatars served by GitHub's avatar CDN are kept (no tracking pixels). */
const AVATAR_PREFIX = "https://avatars.githubusercontent.com/";

export interface HistoryResult {
  commits: CommitNode[];
  contributors: ContributorNode[];
  /** Activity by graph file path. */
  activity: Map<string, FileActivity>;
  timeline: Timeline;
  summary: HistorySummary;
}

interface ContributorAccumulator {
  id: string;
  login?: string;
  providerName?: string;
  /** Author name of the newest commit by this contributor. */
  commitName?: string;
  avatarUrl?: string;
  contributions: number;
  commitCount: number;
  fileIds: Set<string>;
}

interface ActivityAccumulator {
  commitCount: number;
  lastTime: number;
  lastModified?: string;
  lastAuthorId?: string;
  /** Contributor id -> commits touching the file. */
  touches: Map<string, number>;
}

function safeAvatar(url: string | undefined): string | undefined {
  return typeof url === "string" && url.startsWith(AVATAR_PREFIX) ? url : undefined;
}

function authorIdOf(login: string | undefined, name: string | undefined): string | undefined {
  if (login && login.trim() !== "") return contributorIdFromLogin(login.trim());
  if (name && name.trim() !== "") return contributorIdFromName(name);
  return undefined;
}

function profileUrlOf(login: string, repository: RepositoryInfo): string | undefined {
  if (repository.provider !== "github" && repository.provider !== "fixture") return undefined;
  const bot = /^(.+)\[bot\]$/.exec(login);
  if (bot?.[1]) return `https://github.com/apps/${encodeURIComponent(bot[1])}`;
  return `https://github.com/${encodeURIComponent(login)}`;
}

class ContributorRegistry {
  private readonly byId = new Map<string, ContributorAccumulator>();

  ensure(id: string, login: string | undefined): ContributorAccumulator {
    let contributor = this.byId.get(id);
    if (!contributor) {
      contributor = { id, contributions: 0, commitCount: 0, fileIds: new Set() };
      this.byId.set(id, contributor);
    }
    if (login && !contributor.login) contributor.login = login.trim();
    return contributor;
  }

  /** Ranks by contributions, commits in the window, then name; keeps the top 200. */
  finalize(repository: RepositoryInfo): ContributorNode[] {
    return [...this.byId.values()]
      .map((contributor) => {
        const login = contributor.login;
        const node: ContributorNode = {
          id: contributor.id,
          name: contributor.commitName ?? login ?? contributor.providerName ?? contributor.id,
          contributions: contributor.contributions,
          commitCount: contributor.commitCount,
          fileIds: [...contributor.fileIds].sort(compareStrings),
        };
        if (login) node.login = login;
        if (contributor.avatarUrl) node.avatarUrl = contributor.avatarUrl;
        const profileUrl = login ? profileUrlOf(login, repository) : undefined;
        if (profileUrl) node.profileUrl = profileUrl;
        return node;
      })
      .sort((a, b) =>
        compareTuples(
          [-a.contributions, -a.commitCount, a.name.toLowerCase(), a.id],
          [-b.contributions, -b.commitCount, b.name.toLowerCase(), b.id],
        ),
      )
      .slice(0, MAX_CONTRIBUTORS);
  }
}

function registerProviderContributors(registry: ContributorRegistry, history: HistoryInput): void {
  const sources = [...history.contributors].sort((a, b) =>
    compareTuples(
      [-(a.contributions || 0), a.login ?? "", a.name],
      [-(b.contributions || 0), b.login ?? "", b.name],
    ),
  );
  for (const source of sources) {
    const id = authorIdOf(source.login, source.name);
    if (!id) continue;
    const contributor = registry.ensure(id, source.login);
    contributor.contributions = Math.max(
      contributor.contributions,
      nonNegativeInteger(source.contributions) ?? 0,
    );
    contributor.providerName ??= source.name.trim() || undefined;
    contributor.avatarUrl ??= safeAvatar(source.avatarUrl);
  }
}

/** Accumulates per-file activity from commit details and per-file history lookups. */
function collectActivity(
  records: readonly CommitRecord[],
  history: HistoryInput | null,
  graphPaths: ReadonlySet<string>,
  registry: ContributorRegistry,
  authorOf: ReadonlyMap<string, string | undefined>,
): Map<string, ActivityAccumulator> {
  const activity = new Map<string, ActivityAccumulator>();
  const touch = (path: string): ActivityAccumulator => {
    let entry = activity.get(path);
    if (!entry) {
      entry = { commitCount: 0, lastTime: Number.NEGATIVE_INFINITY, touches: new Map() };
      activity.set(path, entry);
    }
    return entry;
  };

  for (const record of records) {
    const id = authorOf.get(record.sha);
    const contributor = id ? registry.ensure(id, record.authorLogin) : undefined;
    // Commits without an identifiable author still count towards file activity.
    for (const path of record.details?.files ?? []) {
      if (!graphPaths.has(path)) continue;
      const entry = touch(path);
      entry.commitCount += 1;
      if (contributor && id) {
        contributor.fileIds.add(fileId(path));
        entry.touches.set(id, (entry.touches.get(id) ?? 0) + 1);
      }
      if (!Number.isNaN(record.time) && record.time > entry.lastTime) {
        entry.lastTime = record.time;
        entry.lastModified = record.date;
        entry.lastAuthorId = id;
      }
    }
  }

  // Start of the analysed history window: the oldest listed commit.
  let windowStart = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (!Number.isNaN(record.time)) windowStart = Math.min(windowStart, record.time);
  }

  const lookups = [...(history?.fileActivity ?? new Map()).entries()].sort(([a], [b]) =>
    compareStrings(a, b),
  );
  for (const [path, source] of lookups) {
    if (!graphPaths.has(path)) continue;
    const date = isoDate(source.lastModified);
    const id = authorIdOf(source.authorLogin, source.authorName);
    const entry = touch(path);
    // A last commit inside the window is at least one commit in it, even when it
    // was not among the commits whose changed files were fetched.
    if (date !== null && Date.parse(date) >= windowStart && entry.commitCount === 0) {
      entry.commitCount = 1;
    }
    if (id) {
      const contributor = registry.ensure(id, source.authorLogin);
      if (contributor.commitName === undefined && source.authorName?.trim()) {
        contributor.commitName = source.authorName.trim();
      }
      contributor.fileIds.add(fileId(path));
      if (!entry.touches.has(id)) entry.touches.set(id, 1);
    }
    if (date !== null && Date.parse(date) > entry.lastTime) {
      entry.lastTime = Date.parse(date);
      entry.lastModified = date;
      entry.lastAuthorId = id;
    }
  }
  return activity;
}

function finalizeActivity(
  activity: ReadonlyMap<string, ActivityAccumulator>,
  kept: ReadonlySet<string>,
): Map<string, FileActivity> {
  const result = new Map<string, FileActivity>();
  for (const path of [...activity.keys()].sort(compareStrings)) {
    const entry = activity.get(path);
    if (!entry) continue;
    const contributorIds = [...entry.touches.entries()]
      .filter(([id]) => kept.has(id))
      .sort(([idA, countA], [idB, countB]) => countB - countA || compareStrings(idA, idB))
      .slice(0, MAX_FILE_CONTRIBUTORS)
      .map(([id]) => id);
    const fileActivity: FileActivity = { commitCount: entry.commitCount, contributorIds };
    if (entry.lastModified !== undefined) fileActivity.lastModified = entry.lastModified;
    if (entry.lastAuthorId !== undefined && kept.has(entry.lastAuthorId)) {
      fileActivity.lastAuthorId = entry.lastAuthorId;
    }
    result.set(path, fileActivity);
  }
  return result;
}

export function buildHistory(
  history: HistoryInput | null,
  graphPaths: ReadonlySet<string>,
  repository: RepositoryInfo,
): HistoryResult {
  const records = history ? mergeCommits(history) : [];
  const registry = new ContributorRegistry();
  if (history) registerProviderContributors(registry, history);

  const authorOf = new Map<string, string | undefined>();
  for (const record of records) {
    const id = authorIdOf(record.authorLogin, record.authorName);
    authorOf.set(record.sha, id);
    if (!id) continue;
    const contributor = registry.ensure(id, record.authorLogin);
    contributor.commitCount += 1;
    // Records are newest first, so the first name seen is the most recent one.
    if (contributor.commitName === undefined && record.authorName.trim() !== "") {
      contributor.commitName = record.authorName.trim();
    }
    contributor.avatarUrl ??= safeAvatar(record.authorAvatarUrl);
  }

  const activity = collectActivity(records, history, graphPaths, registry, authorOf);
  const contributors = registry.finalize(repository);
  const kept = new Set(contributors.map((contributor) => contributor.id));
  const fileActivity = finalizeActivity(activity, kept);
  const commits = buildCommitNodes(
    records,
    (record) => {
      const id = authorOf.get(record.sha);
      return id !== undefined && kept.has(id) ? id : undefined;
    },
    graphPaths,
    repository,
  );

  const dated = records.filter((record) => !Number.isNaN(record.time));
  const summary: HistorySummary = {
    commitsFetched: records.length,
    commitsWithDetails: records.filter((record) => record.details !== undefined).length,
    filesWithActivity: [...fileActivity.values()].filter(
      (entry) => entry.lastModified !== undefined,
    ).length,
    perFileHistory: history?.perFileHistory ?? false,
  };
  const newest = dated[0];
  const oldest = dated[dated.length - 1];
  if (oldest) summary.oldestCommitDate = oldest.date;
  if (newest) summary.newestCommitDate = newest.date;

  return {
    commits,
    contributors,
    activity: fileActivity,
    timeline: buildTimeline(history, records),
    summary,
  };
}
