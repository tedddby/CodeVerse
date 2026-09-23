import { describe, expect, it } from "vitest";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import {
  advancePlayback,
  cursorToSliderValue,
  axisTicks,
  DAY_MS,
  discretePlaybackStep,
  formatWindowRange,
  histogramBars,
  isHistoryTruncated,
  positionOf,
  resolveCursor,
  sliderScale,
  sliderStep,
  sliderValueToCursor,
  timelineExtent,
  windowStats,
} from "./timeline-model";

const REFERENCE = Date.parse("2026-09-01T00:00:00.000Z");

describe("timelineExtent", () => {
  it("spans the buckets and every commit", () => {
    const extent = timelineExtent(mockRepositoryGraph);
    expect(extent).not.toBeNull();
    if (!extent) return;
    const oldestCommit = REFERENCE - 200 * DAY_MS;
    expect(extent.start).toBeLessThanOrEqual(oldestCommit);
    expect(extent.end).toBeGreaterThanOrEqual(REFERENCE - 2 * DAY_MS);
  });

  it("is null without buckets or commits", () => {
    const empty: RepositoryGraph = {
      ...mockRepositoryGraph,
      commits: [],
      timeline: { granularity: "week", coverage: "sampled", buckets: [] },
    };
    expect(timelineExtent(empty)).toBeNull();
  });

  it("falls back to commit dates when there are no buckets", () => {
    const graph: RepositoryGraph = {
      ...mockRepositoryGraph,
      timeline: { granularity: "week", coverage: "sampled", buckets: [] },
    };
    const extent = timelineExtent(graph);
    expect(extent?.start).toBe(REFERENCE - 200 * DAY_MS);
    expect(extent?.end).toBe(REFERENCE - 2 * DAY_MS);
  });
});

describe("histogram and axis", () => {
  it("normalizes bar heights and keeps non-empty buckets visible", () => {
    const bars = histogramBars([
      { start: "2026-01-01T00:00:00.000Z", end: "2026-01-08T00:00:00.000Z", commits: 100 },
      { start: "2026-01-08T00:00:00.000Z", end: "2026-01-15T00:00:00.000Z", commits: 1 },
      { start: "2026-01-15T00:00:00.000Z", end: "2026-01-22T00:00:00.000Z", commits: 0 },
      { start: "bad", end: "2026-01-29T00:00:00.000Z", commits: 5 },
    ]);
    expect(bars.map((bar) => bar.height)).toEqual([1, 0.06, 0]);
  });

  it("uses year ticks for long histories", () => {
    const extent = { start: Date.UTC(2018, 5, 1), end: Date.UTC(2026, 8, 1) };
    const ticks = axisTicks(extent, 10);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    for (const tick of ticks) expect(tick.position).toBeCloseTo(positionOf(tick.time, extent), 10);
  });

  it("thins ticks to the requested maximum", () => {
    const extent = { start: Date.UTC(2000, 0, 15), end: Date.UTC(2026, 0, 15) };
    expect(axisTicks(extent, 6).length).toBeLessThanOrEqual(6);
  });

  it("uses month ticks for sub-three-year histories, labelling January with the year", () => {
    const ticks = axisTicks({ start: Date.UTC(2025, 10, 10), end: Date.UTC(2026, 3, 20) }, 12);
    expect(ticks.map((tick) => tick.label)).toEqual(["Dec", "2026", "Feb", "Mar", "Apr"]);
  });

  it("uses day ticks for very short histories", () => {
    const ticks = axisTicks({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 8) }, 10);
    expect(ticks[0]?.label).toBe("Jan 2");
  });
});

describe("cursor and window statistics", () => {
  const extent = { start: 1_000, end: 5_000 };

  it("resolves null to the latest instant and clamps", () => {
    expect(resolveCursor(null, extent)).toBe(5_000);
    expect(resolveCursor(0, extent)).toBe(1_000);
    expect(resolveCursor(9_999, extent)).toBe(5_000);
    expect(resolveCursor(3_000, extent)).toBe(3_000);
  });

  it("counts commits, distinct files and contributors in the window", () => {
    // Window (Aug 2, Sep 1]: commits a1 (2 days ago), a2 (4), a3 (9), a4 (12), a5 (16), a6 (24).
    const stats = windowStats(mockRepositoryGraph, REFERENCE, 30);
    expect(stats.commits).toBe(6);
    expect(stats.basis).toBe("commits");
    expect(stats.filesChanged).toBe(13);
    expect(stats.contributors).toBe(4);
    expect(stats.commitsWithDetails).toBe(6);
    expect(stats.historyCoverage).toBe("full");
    expect(stats.topFiles).toHaveLength(5);
    expect(stats.topFiles.every((file) => file.changes === 1)).toBe(true);
  });

  it("ranks files changed several times first", () => {
    // 365-day window includes both payments commits touching stripe.ts and types.ts.
    const stats = windowStats(mockRepositoryGraph, REFERENCE, 365);
    expect(stats.commits).toBe(mockRepositoryGraph.commits.length);
    expect(stats.topFiles[0]?.changes).toBe(2);
  });

  it("falls back to file activity when commits carry no file lists", () => {
    const graph: RepositoryGraph = {
      ...mockRepositoryGraph,
      commits: mockRepositoryGraph.commits.map(({ fileIds: _fileIds, ...commit }) => commit),
    };
    const stats = windowStats(graph, REFERENCE, 7);
    expect(stats.basis).toBe("activity");
    expect(stats.commitsWithDetails).toBe(0);
    // Files last modified 2 and 4 days ago.
    expect(stats.filesChanged).toBe(4);
  });

  it("reports partial or missing history when the commit list was truncated", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-09-01T00:00:00.000Z",
      contributors: [{ login: "dev", name: "Dev", contributions: 1 }],
      files: [{ path: "a.ts", lines: 1 }],
      commits: [{ sha: "c1", message: "m", author: "dev", daysAgo: 10, files: ["a.ts"] }],
    });
    const truncated: RepositoryGraph = {
      ...graph,
      analysis: {
        ...graph.analysis,
        warnings: [{ code: "HISTORY_LIMITED", message: "Only the latest commits were read." }],
      },
    };
    expect(isHistoryTruncated(graph)).toBe(false);
    expect(isHistoryTruncated(truncated)).toBe(true);
    expect(windowStats(graph, REFERENCE - 100 * DAY_MS, 30).historyCoverage).toBe("full");
    expect(windowStats(truncated, REFERENCE - 100 * DAY_MS, 30).historyCoverage).toBe("none");
    expect(windowStats(truncated, REFERENCE - 5 * DAY_MS, 30).historyCoverage).toBe("partial");
    expect(windowStats(truncated, REFERENCE, 7).historyCoverage).toBe("full");
  });
});

describe("playback", () => {
  const extent = { start: 0, end: 15_000 * DAY_MS };

  it("advances proportionally to wall-clock time and stops at the end", () => {
    expect(advancePlayback(0, extent, 1_000, 15_000)).toEqual({
      cursor: 1_000 * DAY_MS,
      done: false,
    });
    expect(advancePlayback(14_500 * DAY_MS, extent, 1_000, 15_000)).toEqual({
      cursor: extent.end,
      done: true,
    });
    expect(advancePlayback(0, extent, -5, 15_000).cursor).toBe(0);
  });

  it("steps at least one window (or 1/40 of history) for reduced motion", () => {
    expect(discretePlaybackStep({ start: 0, end: 40 * DAY_MS }, 7)).toBe(7 * DAY_MS);
    expect(discretePlaybackStep({ start: 0, end: 4_000 * DAY_MS }, 7)).toBe(100 * DAY_MS);
  });

  it("maps the cursor to integer slider positions whose last one means latest", () => {
    // 10.5 days: not a whole number of steps, the end must still be reachable.
    const extent = { start: 0, end: 10.5 * DAY_MS };
    const scale = sliderScale(extent);
    expect(scale).toEqual({ step: DAY_MS, max: 11 });
    expect(cursorToSliderValue(null, extent, scale)).toBe(11);
    expect(cursorToSliderValue(3.4 * DAY_MS, extent, scale)).toBe(3);
    expect(cursorToSliderValue(-5, extent, scale)).toBe(0);
    expect(sliderValueToCursor(11, extent, scale)).toBeNull();
    expect(sliderValueToCursor(10, extent, scale)).toBe(10 * DAY_MS);
    expect(sliderValueToCursor(0, extent, scale)).toBe(0);
    for (let value = 0; value < scale.max; value += 1) {
      expect(cursorToSliderValue(sliderValueToCursor(value, extent, scale), extent, scale)).toBe(
        value,
      );
    }
  });

  it("uses day or week slider steps depending on the span", () => {
    expect(sliderStep({ start: 0, end: 100 * DAY_MS })).toBe(DAY_MS);
    expect(sliderStep({ start: 0, end: 1_000 * DAY_MS })).toBe(7 * DAY_MS);
  });

  it("formats window ranges", () => {
    expect(formatWindowRange(Date.UTC(2026, 7, 2), Date.UTC(2026, 8, 1))).toBe(
      "Aug 2 – Sep 1, 2026",
    );
    expect(formatWindowRange(Date.UTC(2025, 11, 20), Date.UTC(2026, 0, 3))).toBe(
      "Dec 20, 2025 – Jan 3, 2026",
    );
  });
});
