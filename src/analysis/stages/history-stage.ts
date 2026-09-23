import type { FileAnalysisResult, HistoryInput } from "@/graph/builders/assemble";
import type { InventoryFile } from "@/graph/builders/inventory";
import { planTimelineRanges } from "@/graph/builders/timeline";
import { formatInteger } from "@/lib/utils/format";
import {
  isSourceError,
  type RepositorySource,
  type SourceCommit,
  type SourceCommitDetails,
  type SourceContributor,
  type SourceFileActivity,
  type SourceSnapshot,
} from "@/sources/types";
import { BUDGET_FRACTIONS, abortError, isAbortError, type PipelineContext } from "./context";
import { historyMessage } from "./messages";
import { runPool } from "./pool";

/**
 * Stage "history": commits, commit details, contributors, per-file activity
 * and exact commit counts. Every step is optional: failures become warnings
 * and never fail the analysis.
 *
 * Commit-level history does not depend on file contents, so it is prefetched
 * in the background while files are downloaded and parsed
 * (`prefetchCommitHistory`); per-file activity needs the parse results and
 * runs when the stage itself starts (`runHistoryStage`).
 */

export const DETAIL_CONCURRENCY = 4;

export interface CommitHistory {
  status: "ok" | "unavailable" | "aborted";
  /** Why `listCommits` failed, when status is "unavailable". */
  unavailableBecause?: "rate-limited" | "error";
  commits: SourceCommit[];
  details: SourceCommitDetails[];
  contributors: SourceContributor[];
  commitCounts: HistoryInput["commitCounts"];
  /** Optional steps skipped to stay within the time budget. */
  trimmed: boolean;
}

function isRateLimited(error: unknown): boolean {
  return isSourceError(error) && error.code === "RATE_LIMITED";
}

async function collectCommitHistory(
  context: PipelineContext,
  source: RepositorySource,
  snapshot: SourceSnapshot,
): Promise<CommitHistory> {
  const { limits, signal } = context;
  const history: CommitHistory = {
    status: "ok",
    commits: [],
    details: [],
    contributors: [],
    commitCounts: null,
    trimmed: false,
  };
  const overBudget = () => {
    const exceeded = context.budgetExceeded(BUDGET_FRACTIONS.history);
    if (exceeded) history.trimmed = true;
    return exceeded;
  };

  if (limits.maxCommits > 0) {
    try {
      history.commits = await source.listCommits(snapshot, {
        maxCommits: limits.maxCommits,
        signal,
      });
    } catch (error) {
      if (isAbortError(error) || context.aborted) return { ...history, status: "aborted" };
      context.recordSourceFailure(error, "listCommits");
      context.logger.info("commit history unavailable", { error });
      return {
        ...history,
        status: "unavailable",
        unavailableBecause: isRateLimited(error) ? "rate-limited" : "error",
      };
    }
  }

  const targets = history.commits.slice(0, Math.max(0, limits.maxCommitDetails));
  if (targets.length > 0 && !overBudget()) {
    const bySha = new Map<string, SourceCommitDetails>();
    const state = { rateLimited: false };
    await runPool(
      targets,
      DETAIL_CONCURRENCY,
      async (commit) => {
        try {
          bySha.set(commit.sha, await source.getCommitDetails(snapshot, commit.sha, signal));
        } catch (error) {
          if (isAbortError(error) || context.aborted) throw error;
          context.recordSourceFailure(error, "getCommitDetails");
          if (isRateLimited(error)) state.rateLimited = true;
        }
      },
      () => !state.rateLimited && !context.aborted && !overBudget(),
    ).catch((error: unknown) => {
      if (!isAbortError(error)) throw error;
    });
    if (context.aborted) return { ...history, status: "aborted" };
    // Newest first, like the commit list.
    history.details = targets.flatMap((commit) => bySha.get(commit.sha) ?? []);
  }

  if (!overBudget()) {
    try {
      history.contributors = await source.listContributors(snapshot, signal);
    } catch (error) {
      if (isAbortError(error) || context.aborted) return { ...history, status: "aborted" };
      context.recordSourceFailure(error, "listContributors");
      context.logger.info("contributors unavailable", { error });
    }
  }

  if (source.capabilities.commitCounts && source.getCommitCounts && !overBudget()) {
    const plan = planTimelineRanges(
      snapshot.repository.createdAt,
      new Date(context.now()).toISOString(),
    );
    if (plan.ranges.length > 0) {
      try {
        const buckets = await source.getCommitCounts(snapshot, plan.ranges, signal);
        history.commitCounts = { granularity: plan.granularity, buckets };
      } catch (error) {
        if (isAbortError(error) || context.aborted) return { ...history, status: "aborted" };
        // The timeline falls back to the sampled commits.
        context.recordSourceFailure(error, "getCommitCounts");
        context.logger.info("exact commit counts unavailable", { error });
      }
    }
  }
  return history;
}

/** Starts collecting commit-level history in the background. The promise never rejects. */
export function prefetchCommitHistory(
  context: PipelineContext,
  source: RepositorySource,
  snapshot: SourceSnapshot,
): Promise<CommitHistory> {
  return collectCommitHistory(context, source, snapshot).catch((error: unknown) => {
    if (!isAbortError(error)) context.logger.warn("history collection failed", { error });
    return {
      status: isAbortError(error) || context.aborted ? "aborted" : "unavailable",
      unavailableBecause: "error",
      commits: [],
      details: [],
      contributors: [],
      commitCounts: null,
      trimmed: false,
    } satisfies CommitHistory;
  });
}

/**
 * Files whose per-file history is looked up: parsed source files first, then
 * the largest remaining graph files, at most `limit`.
 */
export function selectActivityCandidates(
  graphInventory: readonly InventoryFile[],
  analyses: ReadonlyMap<string, FileAnalysisResult>,
  limit: number,
): string[] {
  const bySize = (a: InventoryFile, b: InventoryFile) =>
    b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const parsedSource: InventoryFile[] = [];
  const rest: InventoryFile[] = [];
  for (const file of graphInventory) {
    const status = analyses.get(file.path)?.status;
    const parsed = status === "parsed" || status === "partial";
    (parsed && file.category === "source" ? parsedSource : rest).push(file);
  }
  return [...parsedSource.sort(bySize), ...rest.sort(bySize)]
    .slice(0, Math.max(0, limit))
    .map((file) => file.path);
}

export interface HistoryStageInput {
  source: RepositorySource;
  snapshot: SourceSnapshot;
  prefetched: Promise<CommitHistory>;
  activityCandidates: readonly string[];
}

/** Runs the "history" stage. Resolves to null when history is unavailable. */
export async function runHistoryStage(
  context: PipelineContext,
  input: HistoryStageInput,
): Promise<HistoryInput | null> {
  const stage = context.startStage("history");
  const history = await input.prefetched;
  context.throwIfAborted();
  if (history.status === "aborted") throw abortError();
  if (history.status === "unavailable") {
    if (history.unavailableBecause === "rate-limited") {
      context.addWarning({
        code: "HISTORY_UNAVAILABLE",
        message:
          "Commit history could not be loaded because GitHub's API rate limit was reached, so activity and contributor views are empty.",
      });
    }
    stage.finish("warning", "Commit history unavailable");
    return null;
  }

  const { source, snapshot } = input;
  let fileActivity: ReadonlyMap<string, SourceFileActivity> = new Map();
  let perFileHistory = false;
  const wantsActivity =
    source.capabilities.fileHistory &&
    source.getFileActivity !== undefined &&
    context.limits.maxCommits > 0 &&
    input.activityCandidates.length > 0;
  if (wantsActivity) {
    if (context.budgetExceeded(BUDGET_FRACTIONS.history)) {
      history.trimmed = true;
    } else {
      try {
        fileActivity =
          (await source.getFileActivity?.(
            snapshot,
            [...input.activityCandidates],
            context.signal,
          )) ?? new Map();
        perFileHistory = true;
      } catch (error) {
        if (isAbortError(error) || context.aborted) throw error;
        context.recordSourceFailure(error, "getFileActivity");
        context.logger.info("per-file history unavailable", { error });
      }
    }
  }

  if (history.trimmed) {
    context.addWarning({
      code: "HISTORY_LIMITED",
      message: `Activity is based on the latest ${formatInteger(history.commits.length)} commits; some history lookups were skipped to keep the analysis within its time budget.`,
      detail: { commits: history.commits.length, commitsWithDetails: history.details.length },
    });
    stage.finish("warning", "History trimmed to fit the analysis budget");
  } else {
    stage.finish("done", historyMessage(history.commits.length, history.contributors.length));
  }
  return {
    commits: history.commits,
    details: history.details,
    contributors: history.contributors,
    fileActivity,
    commitCounts: history.commitCounts,
    perFileHistory,
  };
}
