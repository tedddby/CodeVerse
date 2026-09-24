import { describe, expect, it } from "vitest";
import type { RateLimitSnapshot } from "@/graph/model/types";
import {
  QUOTA_RESERVE,
  UNAUTHENTICATED_MAX_COMMITS,
  UNAUTHENTICATED_MAX_COMMIT_DETAILS,
  planHistoryBudget,
} from "./history-stage";

const limits = { maxCommits: 300, maxCommitDetails: 40 };

function quota(remaining: number, authenticated: boolean): RateLimitSnapshot {
  return { limit: authenticated ? 5000 : 60, remaining, resetAt: "2026-09-23T19:00:00.000Z", authenticated };
}

describe("planHistoryBudget", () => {
  it("uses the configured limits when authenticated with plenty of quota", () => {
    expect(planHistoryBudget(limits, quota(4_800, true), true)).toEqual({
      maxCommits: 300,
      maxCommitDetails: 40,
      quotaLimited: false,
      lowQuota: false,
    });
  });

  it("keeps unauthenticated history to a handful of requests", () => {
    const budget = planHistoryBudget(limits, quota(57, false), false);
    expect(budget.maxCommits).toBe(UNAUTHENTICATED_MAX_COMMITS);
    expect(budget.maxCommitDetails).toBe(UNAUTHENTICATED_MAX_COMMIT_DETAILS);
    expect(budget.quotaLimited).toBe(true);
    // The fixed unauthenticated caps are not a transient low-quota condition.
    expect(budget.lowQuota).toBe(false);
    // commits page + contributors + details must leave the reserve untouched
    expect(1 + 1 + budget.maxCommitDetails).toBeLessThanOrEqual(57 - QUOTA_RESERVE);
  });

  it("shrinks details as the remaining quota approaches the reserve", () => {
    const budget = planHistoryBudget(limits, quota(QUOTA_RESERVE + 4, false), false);
    expect(budget.maxCommits).toBe(100);
    expect(budget.maxCommitDetails).toBe(2);
    expect(budget.lowQuota).toBe(true);
  });

  it("skips history entirely when only the reserve is left", () => {
    const budget = planHistoryBudget(limits, quota(QUOTA_RESERVE, true), true);
    expect(budget.maxCommits).toBe(0);
    expect(budget.maxCommitDetails).toBe(0);
    expect(budget.quotaLimited).toBe(true);
  });

  it("limits commit pages for authenticated servers that are nearly out of quota", () => {
    const budget = planHistoryBudget(limits, quota(QUOTA_RESERVE + 3, true), true);
    expect(budget.maxCommits).toBe(200);
    expect(budget.maxCommitDetails).toBe(0);
  });

  it("falls back to the unauthenticated caps when the quota is unknown", () => {
    expect(planHistoryBudget(limits, undefined, false)).toEqual({
      maxCommits: 100,
      maxCommitDetails: 6,
      quotaLimited: true,
      lowQuota: false,
    });
    expect(planHistoryBudget(limits, undefined, true).quotaLimited).toBe(false);
  });

  it("never exceeds the configured limits", () => {
    const small = { maxCommits: 50, maxCommitDetails: 3 };
    expect(planHistoryBudget(small, quota(60, false), false)).toEqual({
      maxCommits: 50,
      maxCommitDetails: 3,
      quotaLimited: false,
      lowQuota: false,
    });
  });
});
