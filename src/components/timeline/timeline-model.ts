import type { RepositoryGraph, TimelineBucket } from "@/graph/model/types";

/**
 * Pure computations behind the history timeline: extent, histogram, axis
 * ticks, the selected window's statistics and playback stepping. All times are
 * epoch milliseconds (UTC).
 */

export const DAY_MS = 86_400_000;

export const WINDOW_OPTIONS: ReadonlyArray<{ days: number; label: string; description: string }> = [
  { days: 7, label: "7d", description: "7 days" },
  { days: 30, label: "30d", description: "30 days" },
  { days: 90, label: "90d", description: "90 days" },
  { days: 365, label: "1y", description: "1 year" },
];

export interface TimelineExtent {
  start: number;
  end: number;
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Time span covered by the timeline buckets, falling back to commit dates. Null without history. */
export function timelineExtent(graph: RepositoryGraph): TimelineExtent | null {
  const { timeline } = graph;
  let start = parseTime(timeline.start) ?? parseTime(timeline.buckets[0]?.start);
  let end =
    parseTime(timeline.end) ?? parseTime(timeline.buckets[timeline.buckets.length - 1]?.end);
  for (const commit of graph.commits) {
    const time = parseTime(commit.date);
    if (time === null) continue;
    if (start === null || time < start) start = time;
    if (end === null || time > end) end = time;
  }
  if (start === null || end === null) return null;
  if (end <= start) end = start + DAY_MS;
  return { start, end };
}

/** Position of `time` within the extent, clamped to 0..1. */
export function positionOf(time: number, extent: TimelineExtent): number {
  const span = extent.end - extent.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (time - extent.start) / span));
}

export interface HistogramBar {
  start: number;
  end: number;
  commits: number;
  /** Bar height 0..1 relative to the busiest bucket (non-empty buckets stay visible). */
  height: number;
}

export function histogramBars(buckets: readonly TimelineBucket[]): HistogramBar[] {
  const max = buckets.reduce((highest, bucket) => Math.max(highest, bucket.commits), 0);
  const bars: HistogramBar[] = [];
  for (const bucket of buckets) {
    const start = parseTime(bucket.start);
    const end = parseTime(bucket.end);
    if (start === null || end === null || end <= start) continue;
    const height = max === 0 || bucket.commits === 0 ? 0 : Math.max(0.06, bucket.commits / max);
    bars.push({ start, end, commits: bucket.commits, height });
  }
  return bars;
}

export interface AxisTick {
  time: number;
  /** 0..1 along the axis. */
  position: number;
  label: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Calendar-aligned ticks: years for multi-year histories, otherwise quarters,
 * months or weeks, thinned to at most `maxTicks`.
 */
export function axisTicks(extent: TimelineExtent, maxTicks = 6): AxisTick[] {
  const spanDays = (extent.end - extent.start) / DAY_MS;
  const candidates: Array<{ time: number; label: string }> = [];
  const first = new Date(extent.start);

  if (spanDays > 3 * 365) {
    for (let year = first.getUTCFullYear() + 1; ; year += 1) {
      const time = Date.UTC(year, 0, 1);
      if (time > extent.end) break;
      candidates.push({ time, label: String(year) });
    }
  } else if (spanDays > 45) {
    const monthStep = spanDays > 540 ? 3 : 1;
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth() + 1;
    for (;;) {
      if (month > 11) {
        year += Math.floor(month / 12);
        month %= 12;
      }
      const time = Date.UTC(year, month, 1);
      if (time > extent.end) break;
      if (month % monthStep === 0)
        candidates.push({ time, label: month === 0 ? String(year) : (MONTHS[month] ?? "") });
      month += 1;
    }
  } else {
    const startDay = Math.ceil(extent.start / DAY_MS) * DAY_MS;
    const step = spanDays > 14 ? 7 : 1;
    for (let time = startDay; time <= extent.end; time += step * DAY_MS) {
      const date = new Date(time);
      candidates.push({ time, label: `${MONTHS[date.getUTCMonth()] ?? ""} ${date.getUTCDate()}` });
    }
  }

  const stride = Math.max(1, Math.ceil(candidates.length / Math.max(1, maxTicks)));
  return candidates
    .filter((_, i) => i % stride === 0)
    .map((candidate) => ({ ...candidate, position: positionOf(candidate.time, extent) }))
    .filter((tick) => tick.position > 0.02 && tick.position < 0.98);
}

/** The effective cursor: null means "latest" (end of the extent); values are clamped. */
export function resolveCursor(cursor: number | null, extent: TimelineExtent): number {
  if (cursor === null || !Number.isFinite(cursor)) return extent.end;
  return Math.min(extent.end, Math.max(extent.start, cursor));
}

export interface FileChangeCount {
  fileId: string;
  changes: number;
}

export interface WindowStats {
  start: number;
  end: number;
  /** Fetched commits authored within the window. */
  commits: number;
  /** Distinct files changed within the window (see `basis`). */
  filesChanged: number;
  contributors: number;
  topFiles: FileChangeCount[];
  /**
   * "commits": from the changed-file lists of fetched commits.
   * "activity": from per-file last-modified dates (a lower bound; commit details unavailable).
   */
  basis: "commits" | "activity";
  /** Commits in the window whose changed files were fetched. */
  commitsWithDetails: number;
  /** How much of the window the fetched commit list covers. */
  historyCoverage: "full" | "partial" | "none";
}

/** Statistics for the window (cursor − windowDays, cursor]. */
export function windowStats(
  graph: RepositoryGraph,
  cursor: number,
  windowDays: number,
  topN = 5,
): WindowStats {
  const end = cursor;
  const start = cursor - Math.max(1, windowDays) * DAY_MS;
  const inWindow = (time: number | null) => time !== null && time > start && time <= end;

  const commits = graph.commits.filter((commit) => inWindow(parseTime(commit.date)));
  const authors = new Set(commits.map((commit) => commit.authorId ?? `name:${commit.authorName}`));
  const detailed = commits.filter((commit) => commit.fileIds !== undefined);

  const counts = new Map<string, number>();
  let basis: WindowStats["basis"] = "commits";
  if (detailed.length > 0) {
    for (const commit of detailed) {
      for (const fileId of commit.fileIds ?? []) counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
    }
  } else {
    basis = "activity";
    for (const file of graph.files) {
      if (inWindow(parseTime(file.activity?.lastModified)))
        counts.set(file.id, file.activity?.commitCount ?? 1);
    }
  }

  const topFiles = [...counts.entries()]
    .map(([fileId, changes]) => ({ fileId, changes }))
    .sort((a, b) => b.changes - a.changes || a.fileId.localeCompare(b.fileId))
    .slice(0, topN);

  return {
    start,
    end,
    commits: commits.length,
    filesChanged: counts.size,
    contributors: authors.size,
    topFiles,
    basis,
    commitsWithDetails: detailed.length,
    historyCoverage: historyCoverageFor(graph, start, end),
  };
}

/** True when older commits exist that were not fetched (the commit list hit its limit). */
export function isHistoryTruncated(graph: RepositoryGraph): boolean {
  const { history, limits, warnings } = graph.analysis;
  return (
    warnings.some((warning) => warning.code === "HISTORY_LIMITED") ||
    history.commitsFetched >= limits.maxCommits
  );
}

function historyCoverageFor(
  graph: RepositoryGraph,
  start: number,
  end: number,
): WindowStats["historyCoverage"] {
  if (graph.commits.length === 0) return "none";
  // Every commit was fetched: an empty window really had no commits.
  if (!isHistoryTruncated(graph)) return "full";
  const oldestFetched =
    parseTime(graph.analysis.history.oldestCommitDate) ??
    graph.commits.reduce(
      (oldest, commit) => Math.min(oldest, parseTime(commit.date) ?? oldest),
      Number.POSITIVE_INFINITY,
    );
  if (end < oldestFetched) return "none";
  return start < oldestFetched ? "partial" : "full";
}

/** Real-time duration of a full playback from the first to the last commit. */
export const PLAYBACK_DURATION_MS = 15_000;

/**
 * Advances a playback cursor by `elapsedMs` of wall-clock time so that the
 * whole extent plays in `durationMs`. Returns `done` once the end is reached.
 */
export function advancePlayback(
  cursor: number,
  extent: TimelineExtent,
  elapsedMs: number,
  durationMs: number = PLAYBACK_DURATION_MS,
): { cursor: number; done: boolean } {
  const rate = (extent.end - extent.start) / Math.max(1, durationMs);
  const next = cursor + Math.max(0, elapsedMs) * rate;
  return next >= extent.end ? { cursor: extent.end, done: true } : { cursor: next, done: false };
}

/** Discrete playback step for reduced motion: one window (at least 1/40 of the extent). */
export function discretePlaybackStep(extent: TimelineExtent, windowDays: number): number {
  return Math.max(windowDays * DAY_MS, (extent.end - extent.start) / 40);
}

/** Slider step: a day for short histories, a week beyond two years. */
export function sliderStep(extent: TimelineExtent): number {
  return extent.end - extent.start > 2 * 365 * DAY_MS ? 7 * DAY_MS : DAY_MS;
}

/**
 * The slider works on integer step indices (0..max) so that its last position
 * is always reachable and means "latest", whatever the span.
 */
export interface SliderScale {
  step: number;
  max: number;
}

export function sliderScale(extent: TimelineExtent): SliderScale {
  const step = sliderStep(extent);
  return { step, max: Math.max(1, Math.ceil((extent.end - extent.start) / step)) };
}

export function cursorToSliderValue(
  cursor: number | null,
  extent: TimelineExtent,
  scale: SliderScale,
): number {
  if (cursor === null) return scale.max;
  return Math.min(scale.max, Math.max(0, Math.round((cursor - extent.start) / scale.step)));
}

/** Slider index back to a cursor; the last index is "latest" (null). */
export function sliderValueToCursor(
  value: number,
  extent: TimelineExtent,
  scale: SliderScale,
): number | null {
  if (!Number.isFinite(value) || value >= scale.max) return null;
  return Math.min(extent.end, extent.start + Math.max(0, Math.round(value)) * scale.step);
}

const rangeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Aug 3 – Sep 1, 2026" (year shown once when both ends share it). */
export function formatWindowRange(start: number, end: number): string {
  const sameYear = new Date(start).getUTCFullYear() === new Date(end).getUTCFullYear();
  return `${(sameYear ? rangeFormatter : fullFormatter).format(start)} – ${fullFormatter.format(end)}`;
}

export function formatDay(time: number): string {
  return fullFormatter.format(time);
}
