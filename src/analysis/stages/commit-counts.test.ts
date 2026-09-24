import { describe, expect, it } from "vitest";
import { deriveCommitCounts } from "@/sources/memory/memory-history";
import type { SourceCommitDetails } from "@/sources/types";
import { countCommitsOverHistory, type CountCommits } from "./commit-counts";

const NOW = "2026-09-23T12:00:00.000Z";

function commitsAt(dates: string[]): SourceCommitDetails[] {
  return dates.map((date, index) => ({
    sha: index.toString(16).padStart(40, "0"),
    message: "change",
    authorName: "Someone",
    date,
    url: "https://example.com",
    files: [],
  }));
}

/** A provider counting the given commits, recording each call's range count. */
function counter(dates: string[]): { count: CountCommits; calls: number[] } {
  const commits = commitsAt(dates);
  const calls: number[] = [];
  return {
    calls,
    count: async (ranges) => {
      calls.push(ranges.length);
      return deriveCommitCounts(ranges, commits);
    },
  };
}

const total = (buckets: Array<{ commits: number }>) =>
  buckets.reduce((sum, bucket) => sum + bucket.commits, 0);

describe("countCommitsOverHistory", () => {
  it("counts from the creation date in one call when nothing predates it", async () => {
    const { count, calls } = counter(["2025-02-01T00:00:00Z", "2026-09-01T00:00:00Z"]);
    const counts = await countCommitsOverHistory(count, "2025-01-06T00:00:00Z", NOW);
    expect(calls).toHaveLength(1);
    expect(counts?.granularity).toBe("month");
    expect(counts?.buckets[0]?.start).toBe("2025-01-01T00:00:00.000Z");
    expect(total(counts?.buckets ?? [])).toBe(2);
  });

  it("extends the timeline back to commits older than the repository (imported history)", async () => {
    // Like torvalds/linux: created on GitHub in 2011, history since 2005.
    const { count, calls } = counter([
      "2005-04-16T22:20:36Z",
      "2009-06-01T00:00:00Z",
      "2011-09-04T00:00:00Z",
      "2026-09-01T00:00:00Z",
    ]);
    const counts = await countCommitsOverHistory(count, "2011-09-04T22:48:12Z", NOW);
    expect(calls).toHaveLength(3);
    expect(counts?.buckets[0]?.start).toBe("2005-01-01T00:00:00.000Z");
    expect(counts?.granularity).toBe("year");
    expect(total(counts?.buckets ?? [])).toBe(4);
    expect(counts?.buckets.at(-1)?.end).toBe("2027-01-01T00:00:00.000Z");
  });

  it("returns null when no range can be planned", async () => {
    const { count, calls } = counter([]);
    expect(await countCommitsOverHistory(count, undefined, "not a date")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("propagates provider failures (the caller falls back to sampling)", async () => {
    const failing: CountCommits = () => Promise.reject(new Error("graphql down"));
    await expect(countCommitsOverHistory(failing, "2025-01-06T00:00:00Z", NOW)).rejects.toThrow(
      "graphql down",
    );
  });
});
