import type { HistoryInput } from "@/graph/builders/assemble";
import { planTimelineRanges } from "@/graph/builders/timeline";
import type { SourceCommitCountBucket } from "@/sources/types";

/**
 * Exact commit counts over a repository's whole history (the "full-history"
 * timeline).
 *
 * Ranges are planned from the provider's creation date, but imported and
 * migrated repositories (torvalds/linux, nodejs/node, python/cpython) have
 * commits older than that. One extra range, sent with the planned ones,
 * counts everything before the plan; only when it is not empty does a yearly
 * probe find the first year with commits, and the ranges are planned again
 * from there.
 */

/** Start of the range counting commits older than the plan (git timestamps are Unix times). */
export const HISTORY_EPOCH_YEAR = 1970;

export type CountCommits = (
  ranges: Array<{ start: string; end: string }>,
) => Promise<SourceCommitCountBucket[]>;

const toIso = (time: number): string => new Date(time).toISOString();

/** Start (ISO) of the first year before `until` with any commit, or null when none is found. */
async function firstYearWithCommits(count: CountCommits, until: string): Promise<string | null> {
  const end = Date.parse(until);
  const years: Array<{ start: string; end: string }> = [];
  for (let year = HISTORY_EPOCH_YEAR; Date.UTC(year, 0, 1) < end; year += 1) {
    years.push({
      start: toIso(Date.UTC(year, 0, 1)),
      end: toIso(Math.min(Date.UTC(year + 1, 0, 1), end)),
    });
  }
  const counts = await count(years);
  return counts.find((bucket) => bucket.commits > 0)?.start ?? null;
}

/** Commit counts from the first commit (or the creation date) until `now`; null when nothing can be planned. */
export async function countCommitsOverHistory(
  count: CountCommits,
  createdAt: string | undefined,
  now: string,
): Promise<HistoryInput["commitCounts"]> {
  const plan = planTimelineRanges(createdAt, now);
  const first = plan.ranges[0];
  if (!first) return null;
  const before = { start: toIso(Date.UTC(HISTORY_EPOCH_YEAR, 0, 1)), end: first.start };
  const [older, ...buckets] = await count([before, ...plan.ranges]);
  if (!older || older.commits === 0) return { granularity: plan.granularity, buckets };

  const earliest = await firstYearWithCommits(count, first.start);
  if (earliest === null) return { granularity: plan.granularity, buckets };
  const extended = planTimelineRanges(earliest, now);
  return { granularity: extended.granularity, buckets: await count(extended.ranges) };
}
