import type { FileAnalysisResult, HistoryInput } from "@/graph/builders/assemble";
import type { InventoryFile } from "@/graph/builders/inventory";
import type { RateLimitSnapshot } from "@/graph/model/types";
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
import { countCommitsOverHistory } from "./commit-counts";
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

/** API calls left untouched so later analyses and the source viewer keep working. */
export const QUOTA_RESERVE = 12;
/** Without a token GitHub allows 60 requests/hour per IP: keep history to a few calls. */
export const UNAUTHENTICATED_MAX_COMMITS = 100;
export const UNAUTHENTICATED_MAX_COMMIT_DETAILS = 6;
const COMMITS_PER_PAGE = 100;

export interface HistoryBudget {
  maxCommits: number;
  maxCommitDetails: number;
  /** True when the plan is smaller than the configured limits because of API quota. */
  quotaLimited: boolean;
  /**
   * True when the provider's remaining quota, rather than the fixed caps for
   * unauthenticated servers, shrank the plan: a transient condition.
   */
  lowQuota: boolean;
}

/**
 * Sizes the history requests to the provider's remaining API quota.
 *
 * History is the most request-hungry stage (one call per commit detail), so
 * unauthenticated servers — and authenticated ones close to their limit —
 * fetch less of it instead of starving every other visitor.
 */
export function planHistoryBudget(
  limits: Pick<PipelineContext["limits"], "maxCommits" | "maxCommitDetails">,
  rateLimit: RateLimitSnapshot | undefined,
  authenticated: boolean,
): HistoryBudget {
  let maxCommits = limits.maxCommits;
  let maxCommitDetails = limits.maxCommitDetails;
  if (!authenticated) {
    maxCommits = Math.min(maxCommits, UNAUTHENTICATED_MAX_COMMITS);
    maxCommitDetails = Math.min(maxCommitDetails, UNAUTHENTICATED_MAX_COMMIT_DETAILS);
  }
  const capped = { maxCommits, maxCommitDetails };
  if (rateLimit) {
    const available = Math.max(0, rateLimit.remaining - QUOTA_RESERVE);
    // One call for contributors, one per page of commits, the rest for details.
    const pages = Math.min(Math.ceil(maxCommits / COMMITS_PER_PAGE), Math.max(0, available - 1));
    maxCommits = Math.min(maxCommits, pages * COMMITS_PER_PAGE);
    maxCommitDetails = Math.min(maxCommitDetails, Math.max(0, available - pages - 1), maxCommits);
  }
  return {
    maxCommits,
    maxCommitDetails,
    quotaLimited: maxCommits < limits.maxCommits || maxCommitDetails < limits.maxCommitDetails,
    lowQuota: maxCommits < capped.maxCommits || maxCommitDetails < capped.maxCommitDetails,
  };
}

export interface CommitHistory {
  status: "ok" | "unavailable" | "aborted";
  /** Why `listCommits` failed, when status is "unavailable". */
  unavailableBecause?: "rate-limited" | "error" | "quota-reserved";
  commits: SourceCommit[];
  details: SourceCommitDetails[];
  contributors: SourceContributor[];
  commitCounts: HistoryInput["commitCounts"];
  /** Optional steps skipped to stay within the time budget. */
  trimmed: boolean;
  /** History was reduced to preserve the provider's API quota. */
  quotaLimited: boolean;
  /** ... because the remaining quota was low (see `HistoryBudget.lowQuota`). */
  lowQuota: boolean;
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
  const rateLimit = source.getRateLimit();
  const budget = planHistoryBudget(
    limits,
    rateLimit,
    rateLimit?.authenticated ?? source.capabilities.fileHistory,
  );
  const history: CommitHistory = {
    status: "ok",
    commits: [],
    details: [],
    contributors: [],
    commitCounts: null,
    trimmed: false,
    quotaLimited: budget.quotaLimited,
    lowQuota: budget.lowQuota,
  };
  const overBudget = () => {
    const exceeded = context.budgetExceeded(BUDGET_FRACTIONS.history);
    if (exceeded) history.trimmed = true;
    return exceeded;
  };

  if (limits.maxCommits > 0 && budget.maxCommits === 0) {
    context.logger.info("commit history skipped to preserve API quota", {
      remaining: rateLimit?.remaining,
    });
    return { ...history, status: "unavailable", unavailableBecause: "quota-reserved" };
  }

  if (budget.maxCommits > 0) {
    try {
      history.commits = await source.listCommits(snapshot, {
        maxCommits: budget.maxCommits,
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

  const targets = history.commits.slice(0, Math.max(0, budget.maxCommitDetails));
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
    if (state.rateLimited) {
      // The quota ran out while reading details: a transient gap, like a low-quota plan.
      history.quotaLimited = true;
      history.lowQuota = true;
    }
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

  const getCommitCounts = source.getCommitCounts?.bind(source);
  if (source.capabilities.commitCounts && getCommitCounts && !overBudget()) {
    try {
      history.commitCounts = await countCommitsOverHistory(
        (ranges) => getCommitCounts(snapshot, ranges, signal),
        snapshot.repository.createdAt,
        new Date(context.now()).toISOString(),
      );
    } catch (error) {
      if (isAbortError(error) || context.aborted) return { ...history, status: "aborted" };
      // The timeline falls back to the sampled commits.
      context.recordSourceFailure(error, "getCommitCounts");
      context.logger.info("exact commit counts unavailable", { error });
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
      quotaLimited: false,
      lowQuota: false,
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
    } else if (history.unavailableBecause === "quota-reserved") {
      context.addWarning({
        code: "HISTORY_UNAVAILABLE",
        message:
          "Commit history was skipped because the server's GitHub API quota is nearly used up. Configure a GitHub token for full history.",
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
      detail: {
        commits: history.commits.length,
        commitsWithDetails: history.details.length,
        reason: "time-budget",
      },
    });
    stage.finish("warning", "History trimmed to fit the analysis budget");
  } else if (history.quotaLimited) {
    context.addWarning({
      code: "HISTORY_LIMITED",
      message: `Activity is based on the latest ${formatInteger(history.commits.length)} commits (file changes from the latest ${formatInteger(history.details.length)}) to conserve GitHub API quota. Configure a GitHub token for deeper history.`,
      detail: {
        commits: history.commits.length,
        commitsWithDetails: history.details.length,
        reason: history.lowQuota ? "low-quota" : "unauthenticated",
      },
    });
    stage.finish("done", historyMessage(history.commits.length, history.contributors.length));
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
