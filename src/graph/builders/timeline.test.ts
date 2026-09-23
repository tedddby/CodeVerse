import { describe, expect, it } from "vitest";
import { bucketCommits, floorToGranularity, planTimelineRanges } from "./timeline";

const iso = (value: string) => new Date(value).toISOString();

describe("floorToGranularity", () => {
  it("aligns to UTC calendar units with Monday-based weeks", () => {
    const time = Date.parse("2026-09-23T17:45:00Z"); // a Wednesday
    expect(new Date(floorToGranularity(time, "day")).toISOString()).toBe(iso("2026-09-23"));
    expect(new Date(floorToGranularity(time, "week")).toISOString()).toBe(iso("2026-09-21"));
    expect(new Date(floorToGranularity(time, "month")).toISOString()).toBe(iso("2026-09-01"));
    expect(new Date(floorToGranularity(time, "quarter")).toISOString()).toBe(iso("2026-07-01"));
    expect(new Date(floorToGranularity(time, "year")).toISOString()).toBe(iso("2026-01-01"));
    // Sunday belongs to the week that started the previous Monday.
    expect(
      new Date(floorToGranularity(Date.parse("2026-09-27T23:00:00Z"), "week")).toISOString(),
    ).toBe(iso("2026-09-21"));
  });
});

describe("planTimelineRanges", () => {
  it("picks the finest granularity within the range budget", () => {
    const weekly = planTimelineRanges("2026-06-01T00:00:00Z", "2026-09-23T00:00:00Z");
    expect(weekly.granularity).toBe("week");
    const monthly = planTimelineRanges("2022-01-15T00:00:00Z", "2026-09-23T00:00:00Z");
    expect(monthly.granularity).toBe("month");
    expect(monthly.ranges).toHaveLength(57);
    const quarterly = planTimelineRanges("2010-03-01T00:00:00Z", "2026-09-23T00:00:00Z");
    expect(quarterly.granularity).toBe("quarter");
    const yearly = planTimelineRanges("1991-08-25T00:00:00Z", "2026-09-23T00:00:00Z");
    expect(yearly.granularity).toBe("year");
    expect(yearly.ranges[0]?.start).toBe(iso("1991-01-01"));
  });

  it("produces contiguous, aligned ranges that cover the end date", () => {
    const { ranges } = planTimelineRanges("2025-11-20T10:00:00Z", "2026-09-23T12:00:00Z");
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]?.start).toBe(ranges[index - 1]?.end);
    }
    const last = ranges[ranges.length - 1];
    expect(Date.parse(last?.start ?? "")).toBeLessThanOrEqual(Date.parse("2026-09-23T12:00:00Z"));
    expect(Date.parse(last?.end ?? "")).toBeGreaterThan(Date.parse("2026-09-23T12:00:00Z"));
    expect(ranges.length).toBeLessThanOrEqual(80);
  });

  it("respects a custom range budget and falls back to the last year without a creation date", () => {
    expect(planTimelineRanges("2024-01-01T00:00:00Z", "2026-09-23T00:00:00Z", 12).granularity).toBe(
      "quarter",
    );
    const unknown = planTimelineRanges(undefined, "2026-09-23T00:00:00Z");
    expect(unknown.granularity).toBe("week");
    expect(unknown.ranges.length).toBeGreaterThanOrEqual(52);
    expect(planTimelineRanges("not a date", "2026-09-23T00:00:00Z").granularity).toBe("week");
  });

  it("handles invalid end dates and creation dates after the end", () => {
    expect(planTimelineRanges("2020-01-01T00:00:00Z", "garbage")).toEqual({
      granularity: "week",
      ranges: [],
    });
    const single = planTimelineRanges("2027-01-01T00:00:00Z", "2026-09-23T00:00:00Z");
    expect(single.ranges).toHaveLength(1);
  });

  it("keeps only the most recent ranges for absurdly long spans", () => {
    const { granularity, ranges } = planTimelineRanges(
      "1900-01-01T00:00:00Z",
      "2026-09-23T00:00:00Z",
      10,
    );
    expect(granularity).toBe("year");
    expect(ranges).toHaveLength(10);
    expect(ranges[9]?.start).toBe(iso("2026-01-01"));
    expect(ranges[0]?.start).toBe(iso("2017-01-01"));
  });
});

describe("bucketCommits", () => {
  it("chooses granularity by span and includes empty buckets", () => {
    const daily = bucketCommits([
      "2026-09-01T10:00:00Z",
      "2026-09-01T11:00:00Z",
      "2026-09-04T09:00:00Z",
    ]);
    expect(daily.granularity).toBe("day");
    expect(daily.buckets.map((bucket) => bucket.commits)).toEqual([2, 0, 0, 1]);
    expect(daily.buckets[0]).toEqual({
      start: iso("2026-09-01"),
      end: iso("2026-09-02"),
      commits: 2,
    });

    expect(bucketCommits(["2026-01-01T00:00:00Z", "2026-09-01T00:00:00Z"]).granularity).toBe(
      "week",
    );
    expect(bucketCommits(["2024-01-01T00:00:00Z", "2026-09-01T00:00:00Z"]).granularity).toBe(
      "month",
    );
    expect(bucketCommits(["2015-01-01T00:00:00Z", "2026-09-01T00:00:00Z"]).granularity).toBe(
      "quarter",
    );
  });

  it("counts every valid date exactly once, ignores invalid ones and accepts any order", () => {
    const dates = [
      "2026-03-05T00:00:00Z",
      "invalid",
      "2025-12-31T23:59:59Z",
      "2026-01-01T00:00:00Z",
      "2026-02-10T00:00:00Z",
    ];
    const result = bucketCommits(dates, "month");
    expect(result.granularity).toBe("month");
    expect(result.buckets.map((bucket) => [bucket.start.slice(0, 7), bucket.commits])).toEqual([
      ["2025-12", 1],
      ["2026-01", 1],
      ["2026-02", 1],
      ["2026-03", 1],
    ]);
    expect(bucketCommits([...dates].reverse(), "month")).toEqual(result);
  });

  it("returns no buckets without valid dates and coarsens explosive granularities", () => {
    expect(bucketCommits([])).toEqual({ granularity: "week", buckets: [] });
    expect(bucketCommits(["nope"], "month")).toEqual({ granularity: "month", buckets: [] });
    const coarse = bucketCommits(["1970-01-01T00:00:00Z", "2026-09-01T00:00:00Z"], "day");
    expect(coarse.granularity).not.toBe("day");
    expect(coarse.buckets.length).toBeLessThanOrEqual(2_000);
    expect(coarse.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(2);
  });
});
