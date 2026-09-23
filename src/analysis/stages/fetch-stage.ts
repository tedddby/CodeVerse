import type { FileAnalysisResult } from "@/graph/builders/assemble";
import type { FetchPlan } from "@/graph/builders/inventory";
import type { AnalysisWarning } from "@/graph/model/types";
import { formatBytes, pluralize } from "@/lib/utils/format";
import {
  isSourceError,
  type RepositorySource,
  type SourceFileResult,
  type SourceSnapshot,
} from "@/sources/types";
import { BUDGET_FRACTIONS, isAbortError, type PipelineContext } from "./context";
import { fetchMessage, progressMessage } from "./messages";
import { runPool } from "./pool";

/**
 * Stage "fetch": downloads the planned file contents with bounded
 * concurrency and turns every outcome into either content (for parsing and
 * line counting) or an honest per-file status.
 *
 * Failure isolation: a failing file never fails the analysis. After
 * `MAX_CONSECUTIVE_RATE_LIMITS` rate-limited reads in a row no further
 * downloads start, and the remaining planned files stay metadata-only.
 * Downloads also stop when the time budget share for fetching or the total
 * byte budget is used up.
 */

export const MAX_CONSECUTIVE_RATE_LIMITS = 3;

export const FETCH_REASONS = {
  rateLimited: "Not downloaded: GitHub rate limit reached",
  timeBudget: "Not analyzed: the analysis time budget ran out",
  missing: "Download failed: the file was not found at this commit",
  failed: "Download failed: GitHub returned an error for this file",
  timeout: "Download failed: GitHub did not respond in time",
} as const;

export interface FetchStageInput {
  source: RepositorySource;
  snapshot: SourceSnapshot;
  plan: FetchPlan;
  graphFiles: ReadonlySet<string>;
}

export interface FetchStageResult {
  /** Text content by path (graph files and resolution configs). */
  contents: Map<string, string>;
  /** Statuses decided while downloading (binary, too large, failed, not downloaded). */
  analyses: Map<string, FileAnalysisResult>;
  bytesDownloaded: number;
  /** Files whose download failed (errors and missing files). */
  failedFiles: number;
  /** Files not downloaded because GitHub's rate limit was reached. */
  rateLimitedFiles: number;
  /** Files not downloaded because the time or byte budget ran out. */
  budgetSkippedFiles: number;
}

type StopReason = "rate-limit" | "time-budget" | "byte-budget";

/** Every planned download, configs first, each path once. */
export function plannedDownloads(plan: FetchPlan): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of [...plan.configFiles, ...plan.parseFiles, ...plan.contentOnlyFiles]) {
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

function failureReason(error: unknown): string {
  return isSourceError(error) && error.code === "TIMEOUT"
    ? FETCH_REASONS.timeout
    : FETCH_REASONS.failed;
}

export async function runFetchStage(
  context: PipelineContext,
  input: FetchStageInput,
): Promise<FetchStageResult> {
  const { limits } = context;
  const downloads = plannedDownloads(input.plan);
  const result: FetchStageResult = {
    contents: new Map(),
    analyses: new Map(),
    bytesDownloaded: 0,
    failedFiles: 0,
    rateLimitedFiles: 0,
    budgetSkippedFiles: 0,
  };
  const stage = context.startStage("fetch");
  if (downloads.length === 0) {
    stage.finish("skipped", "Nothing to download");
    return result;
  }

  // Resolution configs that are not graph files only feed the resolvers; they get no status.
  const setStatus = (path: string, analysis: FileAnalysisResult) => {
    if (input.graphFiles.has(path)) result.analyses.set(path, analysis);
  };
  let consecutiveRateLimits = 0;
  const state: { stopReason: StopReason | null } = { stopReason: null };
  let completed = 0;
  let textFiles = 0;

  const apply = (path: string, file: SourceFileResult) => {
    switch (file.kind) {
      case "text":
        result.contents.set(path, file.content);
        result.bytesDownloaded += file.size;
        textFiles += 1;
        break;
      case "binary":
        setStatus(path, { status: "binary" });
        break;
      case "too-large":
        setStatus(path, {
          status: "metadata-only",
          statusReason: `Not analyzed: larger than ${formatBytes(limits.maxFileBytes)}`,
        });
        break;
      case "missing":
        result.failedFiles += 1;
        setStatus(path, { status: "failed", statusReason: FETCH_REASONS.missing });
        break;
    }
  };

  const download = async (path: string): Promise<void> => {
    try {
      const file = await input.source.readFile(input.snapshot, path, {
        maxBytes: limits.maxFileBytes,
        signal: context.signal,
      });
      consecutiveRateLimits = 0;
      apply(path, file);
    } catch (error) {
      if (context.aborted || isAbortError(error)) throw error;
      context.recordSourceFailure(error, "readFile");
      if (isSourceError(error) && error.code === "RATE_LIMITED") {
        consecutiveRateLimits += 1;
        result.rateLimitedFiles += 1;
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) state.stopReason = "rate-limit";
        setStatus(path, { status: "metadata-only", statusReason: FETCH_REASONS.rateLimited });
      } else {
        consecutiveRateLimits = 0;
        result.failedFiles += 1;
        setStatus(path, { status: "failed", statusReason: failureReason(error) });
        context.logger.debug("file download failed", { path, error });
      }
    } finally {
      completed += 1;
      stage.progress(completed, downloads.length, progressMessage(completed, downloads.length));
    }
  };

  const shouldStart = () => {
    if (context.aborted || state.stopReason !== null) return false;
    if (context.budgetExceeded(BUDGET_FRACTIONS.fetch)) state.stopReason = "time-budget";
    else if (result.bytesDownloaded >= limits.maxTotalBytes) state.stopReason = "byte-budget";
    return state.stopReason === null;
  };

  const started = await runPool(downloads, limits.fetchConcurrency, download, shouldStart);
  const { stopReason } = state;
  context.throwIfAborted();

  const byteBudgetReason = `Not analyzed: download budget of ${formatBytes(limits.maxTotalBytes)} reached`;
  for (const path of downloads.slice(started)) {
    if (stopReason === "rate-limit") {
      result.rateLimitedFiles += 1;
      setStatus(path, { status: "metadata-only", statusReason: FETCH_REASONS.rateLimited });
    } else {
      result.budgetSkippedFiles += 1;
      setStatus(path, {
        status: "metadata-only",
        statusReason: stopReason === "byte-budget" ? byteBudgetReason : FETCH_REASONS.timeBudget,
      });
    }
  }

  const summary = fetchMessage(textFiles, result.bytesDownloaded);
  const warning = fetchWarning(result);
  if (!warning) {
    stage.finish("done", summary);
  } else {
    context.addWarning(warning);
    const failures = result.failedFiles + result.rateLimitedFiles;
    const message =
      stopReason === "rate-limit"
        ? "Stopped early: GitHub rate limit reached"
        : stopReason !== null
          ? "Stopped early to stay within the analysis budget"
          : `${summary} · ${pluralize(failures, "failure")}`;
    stage.finish("warning", message);
  }
  return result;
}

/** FETCH_FAILURES warning describing every file the fetch stage could not download. */
export function fetchWarning(
  result: Pick<FetchStageResult, "rateLimitedFiles" | "failedFiles" | "budgetSkippedFiles">,
): AnalysisWarning | null {
  const parts: string[] = [];
  const { rateLimitedFiles: limited, failedFiles: failed, budgetSkippedFiles: skipped } = result;
  if (limited > 0) {
    parts.push(
      `GitHub's rate limit was reached while downloading, so ${pluralize(limited, "file")} ${limited === 1 ? "was" : "were"} not analyzed.`,
    );
  }
  if (failed > 0) {
    parts.push(`${pluralize(failed, "file")} could not be downloaded.`);
  }
  if (skipped > 0) {
    parts.push(
      `Downloading stopped early to stay within the analysis budget; ${pluralize(skipped, "file")} ${skipped === 1 ? "was" : "were"} not analyzed.`,
    );
  }
  if (parts.length === 0) return null;
  return {
    code: "FETCH_FAILURES",
    message: parts.join(" "),
    detail: { rateLimited: limited, failed, notDownloaded: skipped },
  };
}
