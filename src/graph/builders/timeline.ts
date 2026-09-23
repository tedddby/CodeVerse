import type { TimelineBucket, TimelineGranularity } from "@/graph/model/types";

/**
 * Timeline helpers. All boundaries are aligned to UTC calendar units
 * (weeks start on Monday) so buckets from different sources line up and the
 * same dates always produce the same buckets.
 */

const DAY_MS = 86_400_000;

/** Granularities from finest to coarsest. */
const GRANULARITY_ORDER: readonly TimelineGranularity[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

/** Safety net against corrupt dates (e.g. 1970 epoch commits) producing huge bucket arrays. */
const MAX_BUCKETS = 2_000;

/** Start of the UTC calendar unit containing `time`. */
export function floorToGranularity(time: number, granularity: TimelineGranularity): number {
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (granularity) {
    case "day":
      return Date.UTC(year, month, date.getUTCDate());
    case "week": {
      const dayStart = Date.UTC(year, month, date.getUTCDate());
      const daysSinceMonday = (date.getUTCDay() + 6) % 7;
      return dayStart - daysSinceMonday * DAY_MS;
    }
    case "month":
      return Date.UTC(year, month, 1);
    case "quarter":
      return Date.UTC(year, month - (month % 3), 1);
    case "year":
      return Date.UTC(year, 0, 1);
  }
}

/** Start of the next UTC calendar unit after the aligned boundary `time`. */
export function addGranularity(time: number, granularity: TimelineGranularity): number {
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  switch (granularity) {
    case "day":
      return Date.UTC(year, month, day + 1);
    case "week":
      return Date.UTC(year, month, day + 7);
    case "month":
      return Date.UTC(year, month + 1, 1);
    case "quarter":
      return Date.UTC(year, month + 3, 1);
    case "year":
      return Date.UTC(year + 1, 0, 1);
  }
}

/** Number of aligned units needed to cover [start, end], stopping early past `stopAfter`. */
function countUnits(
  start: number,
  end: number,
  granularity: TimelineGranularity,
  stopAfter: number,
): number {
  let count = 0;
  for (
    let t = floorToGranularity(start, granularity);
    t <= end;
    t = addGranularity(t, granularity)
  ) {
    count += 1;
    if (count > stopAfter) break;
  }
  return count;
}

function rangesBetween(
  start: number,
  end: number,
  granularity: TimelineGranularity,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let t = floorToGranularity(start, granularity); t <= end;) {
    const next = addGranularity(t, granularity);
    ranges.push({ start: t, end: next });
    t = next;
  }
  return ranges;
}

const toIso = (time: number): string => new Date(time).toISOString();

/**
 * Plans the date ranges for exact commit-count queries over a repository's
 * lifetime. Picks the finest of week/month/quarter/year that needs at most
 * `maxRanges` ranges. When the creation date is unknown or invalid, the last
 * year before `end` is planned. Ranges are [start, end) and cover `end`.
 */
export function planTimelineRanges(
  createdAt: string | undefined,
  end: string,
  maxRanges = 80,
): { granularity: TimelineGranularity; ranges: Array<{ start: string; end: string }> } {
  const endTime = Date.parse(end);
  if (Number.isNaN(endTime)) return { granularity: "week", ranges: [] };
  const limit = Math.max(1, Math.floor(maxRanges));
  const parsedStart = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
  const startTime = Number.isNaN(parsedStart)
    ? endTime - 365 * DAY_MS
    : Math.min(parsedStart, endTime);

  const candidates: readonly TimelineGranularity[] = ["week", "month", "quarter", "year"];
  for (const granularity of candidates) {
    if (countUnits(startTime, endTime, granularity, limit) <= limit) {
      const ranges = rangesBetween(startTime, endTime, granularity);
      return {
        granularity,
        ranges: ranges.map((r) => ({ start: toIso(r.start), end: toIso(r.end) })),
      };
    }
  }
  // Only reachable for spans longer than `maxRanges` years: keep the most recent ranges.
  let rangeStart = floorToGranularity(endTime, "year");
  const ranges: Array<{ start: string; end: string }> = [];
  for (let index = 0; index < limit; index += 1) {
    ranges.unshift({ start: toIso(rangeStart), end: toIso(addGranularity(rangeStart, "year")) });
    rangeStart = Date.UTC(new Date(rangeStart).getUTCFullYear() - 1, 0, 1);
  }
  return { granularity: "year", ranges };
}

/** Granularity for a sampled timeline spanning `spanMs`. */
export function granularityForSpan(spanMs: number): TimelineGranularity {
  if (spanMs <= 45 * DAY_MS) return "day";
  if (spanMs <= 365 * DAY_MS) return "week";
  if (spanMs <= 4 * 365 * DAY_MS) return "month";
  return "quarter";
}

/**
 * Buckets commit dates into a contiguous timeline (empty buckets included
 * between the first and last commit). Invalid dates are ignored. When
 * `granularity` is omitted it is chosen from the span: <= 45 days: day,
 * <= 1 year: week, <= 4 years: month, otherwise quarter. A granularity that
 * would produce more than 2,000 buckets is coarsened.
 */
export function bucketCommits(
  dates: string[],
  granularity?: TimelineGranularity,
): { granularity: TimelineGranularity; buckets: TimelineBucket[] } {
  const times = dates
    .map((date) => Date.parse(date))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined)
    return { granularity: granularity ?? "week", buckets: [] };

  let chosen = granularity ?? granularityForSpan(last - first);
  let order = GRANULARITY_ORDER.indexOf(chosen);
  while (
    order < GRANULARITY_ORDER.length - 1 &&
    countUnits(first, last, chosen, MAX_BUCKETS) > MAX_BUCKETS
  ) {
    order += 1;
    chosen = GRANULARITY_ORDER[order] ?? "year";
  }

  const buckets: TimelineBucket[] = [];
  let cursor = 0;
  for (const range of rangesBetween(first, last, chosen)) {
    let commits = 0;
    while (cursor < times.length && (times[cursor] ?? Number.POSITIVE_INFINITY) < range.end) {
      commits += 1;
      cursor += 1;
    }
    buckets.push({ start: toIso(range.start), end: toIso(range.end), commits });
  }
  return { granularity: chosen, buckets };
}
