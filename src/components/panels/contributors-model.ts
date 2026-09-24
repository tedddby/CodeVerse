import { isHistoryTruncated } from "@/components/timeline/timeline-model";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { CommitNode, ContributorNode, RepositoryGraph } from "@/graph/model/types";
import { formatDate, formatInteger, pluralize } from "@/lib/utils/format";
import { latestCommits } from "./analytics-model";

/** Pure derivations for the contributors panel. Uses only public repository data. */

const AVATAR_ORIGIN = "https://avatars.githubusercontent.com/";

/** Avatars are only loaded from GitHub's avatar CDN. */
export function isSafeAvatarUrl(url: string | undefined): url is string {
  return typeof url === "string" && url.startsWith(AVATAR_ORIGIN) && !/[\s"'<>\\]/.test(url);
}

/** "Ada Lovelace" -> "AL", "octocat" -> "OC", "" -> "?". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "?").slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ""}${words[words.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
}

/**
 * Most files touched in the analysed window first, then most commits in it,
 * then most all-time contributions. The people GitHub ranks first (founders,
 * bots) often have nothing in a short window, and selecting them would
 * highlight no files.
 */
export function sortContributors(contributors: readonly ContributorNode[]): ContributorNode[] {
  return [...contributors].sort(
    (a, b) =>
      b.fileIds.length - a.fileIds.length ||
      b.commitCount - a.commitCount ||
      b.contributions - a.contributions ||
      a.name.localeCompare(b.name),
  );
}

/** Whether selecting the contributor highlights anything: they touched files in the analysed window. */
export function touchedFilesInWindow(contributor: ContributorNode): boolean {
  return contributor.fileIds.length > 0;
}

/** Splits (sorted) contributors into those with touched files in the window and the rest, keeping order. */
export function partitionByWindowActivity(contributors: readonly ContributorNode[]): {
  active: ContributorNode[];
  inactive: ContributorNode[];
} {
  const active: ContributorNode[] = [];
  const inactive: ContributorNode[] = [];
  for (const contributor of contributors)
    (touchedFilesInWindow(contributor) ? active : inactive).push(contributor);
  return { active, inactive };
}

export interface ActiveArea {
  directoryId: string;
  /** Display path with a trailing slash, e.g. "packages/react/". */
  label: string;
  /** Files touched by the contributor within this area. */
  files: number;
}

/** Depth at which touched files are grouped into "areas" (e.g. packages/react/). */
export const AREA_DEPTH = 2;

/**
 * Directories where a contributor touched the most files within the analysed
 * window. Each touched file counts towards its ancestor at depth ≤ AREA_DEPTH;
 * files at the repository root are not attributed to an area.
 */
export function mostActiveAreas(
  index: GraphIndex,
  contributor: ContributorNode,
  limit = 3,
): ActiveArea[] {
  const counts = new Map<string, number>();
  for (const fileId of contributor.fileIds) {
    const file = index.filesById.get(fileId);
    if (!file) continue;
    const chain = index.ancestorsOf(file.directoryId);
    // chain[0] is the root; chain[AREA_DEPTH] is the area (or the deepest available).
    const areaId = chain[Math.min(AREA_DEPTH, chain.length - 1)];
    if (!areaId || areaId === index.graph.rootDirectoryId) continue;
    counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([directoryId, files]) => {
      const directory = index.directoriesById.get(directoryId);
      return { directoryId, label: `${directory?.path ?? directoryId}/`, files };
    })
    .sort((a, b) => b.files - a.files || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** The contributor's commits in the analysed window, newest first. */
export function recentCommits(
  graph: RepositoryGraph,
  contributorId: string,
  limit = 8,
): CommitNode[] {
  return graph.commits
    .filter((commit) => commit.authorId === contributorId)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
}

/**
 * Plain-language description of the history window per-contributor numbers are
 * based on, e.g. "the latest 40 commits with file details (Jun 3 – Sep 1, 2026)".
 */
export function historyWindowDescription(graph: RepositoryGraph): string | null {
  const history = graph.analysis.history;
  if (history.commitsFetched === 0) return null;
  const range =
    history.oldestCommitDate && history.newestCommitDate
      ? ` (${formatDate(history.oldestCommitDate)} – ${formatDate(history.newestCommitDate)})`
      : "";
  if (history.commitsWithDetails === 0) {
    return `the latest ${pluralize(history.commitsFetched, "commit")}${range}; file-level details were not fetched`;
  }
  if (history.commitsWithDetails < history.commitsFetched) {
    return `file details of the latest ${pluralize(history.commitsWithDetails, "commit")} (of ${pluralize(history.commitsFetched, "commit")} read${range})`;
  }
  return `the latest ${pluralize(history.commitsFetched, "commit")}${range}`;
}

/**
 * Why selecting a contributor highlights no files, for their detail block, or
 * null when they touched files in the analysed window (or no history was
 * analysed at all). Says how much history was examined, e.g. "No file changes
 * in the analysed window — only the latest 40 commits were examined."
 */
export function noFileChangesNote(
  graph: RepositoryGraph,
  contributor: ContributorNode,
): string | null {
  if (touchedFilesInWindow(contributor)) return null;
  const { commitsFetched, commitsWithDetails } = graph.analysis.history;
  if (commitsFetched === 0) return null;
  const theirs = graph.commits.filter((commit) => commit.authorId === contributor.id);
  if (theirs.length === 0) {
    if (isHistoryTruncated(graph)) {
      const verb = commitsFetched === 1 ? "was" : "were";
      return `No file changes in the analysed window — only ${latestCommits(commitsFetched)} ${verb} examined.`;
    }
    // Every commit was read: none of them is linked to this contributor.
    const none =
      commitsFetched === 1
        ? "its only commit is not theirs"
        : `none of its ${formatInteger(commitsFetched)} commits are theirs`;
    return `No file changes in the analysed history — ${none}.`;
  }
  // File details were fetched for some of their commits, but none of those files is in the graph.
  if (theirs.some((commit) => commit.fileIds !== undefined)) {
    return "No changes to files in this view — the files their commits in the analysed window changed were deleted or are not shown.";
  }
  if (commitsWithDetails === 0) {
    return "No file changes in the analysed window — file details were not fetched for any commit.";
  }
  const notTheirs = commitsWithDetails === 1 ? "which is not theirs" : "and none are theirs";
  return `No file changes in the analysed window — file details were fetched for only ${latestCommits(commitsWithDetails)}, ${notTheirs}.`;
}
