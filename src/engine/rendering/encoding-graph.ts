import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import { DAY_MS } from "./encoding-types";
import { CONTRIBUTOR_PALETTE } from "./palette";

/**
 * Graph-derived sets and rankings used by the visual encodings: selection
 * subjects, import relations, timeline activity and contributor ownership.
 */

/** Number of contributors that receive a categorical color. */
export const TOP_CONTRIBUTOR_COUNT = 8;

export function dependencyDegree(fileId: string, index: GraphIndex): number {
  return (
    (index.dependenciesBySource.get(fileId)?.length ?? 0) +
    (index.dependenciesByTarget.get(fileId)?.length ?? 0)
  );
}

/** File ids represented by a selection (a file, the file of a symbol, or a directory subtree). */
export function selectionFileIds(
  selection: NodeRef | null,
  index: GraphIndex,
): ReadonlySet<string> {
  if (!selection) return new Set();
  switch (selection.kind) {
    case "file":
      return index.filesById.has(selection.id) ? new Set([selection.id]) : new Set();
    case "symbol": {
      const symbol = index.symbolsById.get(selection.id);
      return symbol ? new Set([symbol.fileId]) : new Set();
    }
    case "directory":
      return new Set(index.filesUnder(selection.id));
  }
}

/** The single file a selection or hover points at (file itself or a symbol's file). */
export function refFileId(ref: NodeRef | null, index: GraphIndex): string | null {
  if (!ref) return null;
  if (ref.kind === "file") return ref.id;
  if (ref.kind === "symbol") return index.symbolsById.get(ref.id)?.fileId ?? null;
  return null;
}

export interface Relations {
  outgoing: Set<string>;
  incoming: Set<string>;
}

/** Files imported by (outgoing) and importing (incoming) a set of files, excluding the set itself. */
export function relatedFiles(fileIds: ReadonlySet<string>, index: GraphIndex): Relations {
  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  for (const id of fileIds) {
    for (const edge of index.dependenciesBySource.get(id) ?? []) {
      if (!fileIds.has(edge.target)) outgoing.add(edge.target);
    }
    for (const edge of index.dependenciesByTarget.get(id) ?? []) {
      if (!fileIds.has(edge.source)) incoming.add(edge.source);
    }
  }
  return { outgoing, incoming };
}

/**
 * Files active in the timeline window [cursor - windowDays, cursor], mapped to
 * the most recent activity time inside the window.
 */
export function filesActiveInWindow(
  index: GraphIndex,
  cursor: number,
  windowDays: number,
): Map<string, number> {
  const start = cursor - Math.max(0, windowDays) * DAY_MS;
  const active = new Map<string, number>();
  const note = (fileId: string, time: number) => {
    const previous = active.get(fileId);
    if (previous === undefined || time > previous) active.set(fileId, time);
  };
  for (const commit of index.graph.commits) {
    if (!commit.fileIds || commit.fileIds.length === 0) continue;
    const time = Date.parse(commit.date);
    if (Number.isNaN(time) || time < start || time > cursor) continue;
    for (const fileId of commit.fileIds) note(fileId, time);
  }
  for (const file of index.graph.files) {
    const iso = file.activity?.lastModified;
    if (!iso) continue;
    const time = Date.parse(iso);
    if (!Number.isNaN(time) && time >= start && time <= cursor) note(file.id, time);
  }
  return active;
}

/** Files touched by a contributor (explicit list ∪ per-file activity). */
export function filesTouchedBy(index: GraphIndex, contributorId: string): Set<string> {
  const touched = new Set<string>(index.contributorsById.get(contributorId)?.fileIds ?? []);
  for (const file of index.graph.files) {
    const activity = file.activity;
    if (!activity) continue;
    if (
      activity.lastAuthorId === contributorId ||
      activity.contributorIds.includes(contributorId)
    ) {
      touched.add(file.id);
    }
  }
  return touched;
}

const topContributorCache = new WeakMap<GraphIndex, readonly string[]>();

/**
 * Ids of the most active contributors (commits in the analysed window, then
 * all-time contributions), used for the categorical contributor palette.
 */
export function rankTopContributors(
  index: GraphIndex,
  limit = TOP_CONTRIBUTOR_COUNT,
): readonly string[] {
  const cached = topContributorCache.get(index);
  if (cached && limit === TOP_CONTRIBUTOR_COUNT) return cached;
  const ranked = index.graph.contributors
    .filter((c) => c.commitCount > 0 || c.contributions > 0 || c.fileIds.length > 0)
    .sort(
      (a, b) =>
        b.commitCount - a.commitCount ||
        b.contributions - a.contributions ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit)
    .map((c) => c.id);
  if (limit === TOP_CONTRIBUTOR_COUNT) topContributorCache.set(index, ranked);
  return ranked;
}

/** Hex color of a contributor in the categorical palette, or null when not in the top set. */
export function contributorColor(index: GraphIndex, contributorId: string): string | null {
  const position = rankTopContributors(index).indexOf(contributorId);
  return position === -1
    ? null
    : (CONTRIBUTOR_PALETTE[position % CONTRIBUTOR_PALETTE.length] ?? null);
}
