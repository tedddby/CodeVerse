import type {
  AnalysisCoverage,
  AnalysisReport,
  AnalysisWarning,
  AnalysisWarningCode,
  FileAnalysisStatus,
  FileNode,
  HistorySummary,
} from "@/graph/model/types";
import { snapshotLimits } from "@/lib/config/limits";
import { getLanguage, isParseableLanguage } from "@/lib/languages/registry";
import { formatBytes, formatInteger, pluralize } from "@/lib/utils/format";
import type { ImportStats } from "../dependencies";
import type { SkipReason } from "../fetch-plan";
import { compareStrings, compareTuples, sortRecordKeys } from "../sort";
import type { AssembleInput } from "./types";

/**
 * AnalysisReport construction: coverage counts derived from the assembled
 * files (so they always agree with the graph) and honest, user-facing warnings.
 */

/** Display order of warnings, most fundamental first. */
const WARNING_ORDER: readonly AnalysisWarningCode[] = [
  "EMPTY_REPOSITORY",
  "TREE_TRUNCATED",
  "LARGE_REPOSITORY",
  "FILE_NODE_LIMIT",
  "PARSE_LIMIT",
  "BYTE_LIMIT",
  "UNSUPPORTED_LANGUAGES",
  "PARSE_FAILURES",
  "FETCH_FAILURES",
  "HISTORY_UNAVAILABLE",
  "HISTORY_LIMITED",
  "RATE_LIMIT_LOW",
];

const MAX_LISTED_LANGUAGES = 5;

export interface ReportInput {
  input: Omit<AssembleInput, "analyses" | "dependencies">;
  files: readonly FileNode[];
  directoryCount: number;
  symbolCount: number;
  importStats: ImportStats;
  history: HistorySummary;
  preview: boolean;
}

function safeIso(time: number): string {
  return new Date(Number.isFinite(time) ? time : 0).toISOString();
}

function countStatuses(files: readonly FileNode[]): Record<FileAnalysisStatus, number> {
  const counts: Record<FileAnalysisStatus, number> = {
    parsed: 0,
    partial: 0,
    "content-only": 0,
    "metadata-only": 0,
    binary: 0,
    failed: 0,
  };
  for (const file of files) counts[file.status] += 1;
  return counts;
}

/** Source-category languages present in the repository that CodeVerse cannot parse. */
export function unsupportedLanguagesOf(
  input: Pick<AssembleInput, "inventory">,
): AnalysisReport["unsupportedLanguages"] {
  const counts = new Map<string, number>();
  for (const file of input.inventory.files) {
    if (file.isGenerated) continue;
    const info = getLanguage(file.language);
    if (info.category !== "source" || isParseableLanguage(info.id)) continue;
    counts.set(info.id, (counts.get(info.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, files]) => ({ language, name: getLanguage(language).name, files }))
    .sort((a, b) => compareTuples([-a.files, a.name], [-b.files, b.name]));
}

function listNames(names: readonly string[]): string {
  if (names.length <= MAX_LISTED_LANGUAGES) return names.join(", ");
  const shown = names.slice(0, MAX_LISTED_LANGUAGES).join(", ");
  return `${shown} and ${formatInteger(names.length - MAX_LISTED_LANGUAGES)} more`;
}

function countSkipped(
  skipped: ReadonlyMap<string, SkipReason> | undefined,
  reason: SkipReason,
): number {
  let count = 0;
  for (const value of skipped?.values() ?? []) if (value === reason) count += 1;
  return count;
}

function deriveWarnings(
  report: ReportInput,
  coverage: AnalysisCoverage,
  unsupported: AnalysisReport["unsupportedLanguages"],
): AnalysisWarning[] {
  const { input, history } = report;
  const warnings: AnalysisWarning[] = [];
  const total = input.inventory.files.length;

  if (total === 0) {
    warnings.push({
      code: "EMPTY_REPOSITORY",
      message: "This repository has no files to visualize.",
    });
  }
  if (input.inventory.truncated) {
    warnings.push({
      code: "TREE_TRUNCATED",
      message: "The file listing for this repository was truncated, so some files are missing.",
    });
  }
  if (input.tier === "directory-first") {
    warnings.push({
      code: "LARGE_REPOSITORY",
      message:
        "This repository is very large. CodeVerse visualizes the architecture first and analyzed a representative sample of files.",
    });
  }
  if (coverage.filesInGraph < total) {
    warnings.push({
      code: "FILE_NODE_LIMIT",
      message: `Showing ${formatInteger(coverage.filesInGraph)} of ${formatInteger(total)} files as buildings; directory totals include the rest.`,
      detail: { shown: coverage.filesInGraph, total },
    });
  }

  const skipped = input.fetchPlan?.skipped;
  if (!report.preview && countSkipped(skipped, "parse-limit") > 0 && input.fetchPlan) {
    const parsed = coverage.filesParsed + coverage.filesPartial;
    const eligible = Math.max(input.fetchPlan.eligibleParseFiles, parsed);
    warnings.push({
      code: "PARSE_LIMIT",
      message: `Parsed ${formatInteger(parsed)} of ${formatInteger(eligible)} eligible source files. Other files show size-based estimates.`,
      detail: { parsed, eligible },
    });
  }
  const overBudget = report.preview ? 0 : countSkipped(skipped, "byte-budget");
  if (overBudget > 0) {
    warnings.push({
      code: "BYTE_LIMIT",
      message: `The ${formatBytes(input.limits.maxTotalBytes)} download budget was reached; ${pluralize(overBudget, "file")} ${overBudget === 1 ? "shows" : "show"} size-based estimates.`,
      detail: { files: overBudget, maxTotalBytes: input.limits.maxTotalBytes },
    });
  }
  if (unsupported.length > 0) {
    warnings.push({
      code: "UNSUPPORTED_LANGUAGES",
      message: `Some files could not be parsed because their language is not currently supported: ${listNames(unsupported.map((entry) => entry.name))}.`,
      detail: { languages: unsupported.length },
    });
  }
  if (coverage.filesFailed > 0) {
    warnings.push({
      code: "PARSE_FAILURES",
      message: `${pluralize(coverage.filesFailed, "file")} could not be analyzed; ${coverage.filesFailed === 1 ? "its" : "their"} symbols and imports are missing.`,
      detail: { files: coverage.filesFailed },
    });
  }

  if (!report.preview && input.history === null && total > 0) {
    warnings.push({
      code: "HISTORY_UNAVAILABLE",
      message: "Commit history could not be loaded, so activity and contributor views are empty.",
    });
  }
  const fetched = history.commitsFetched;
  const detailed = history.commitsWithDetails;
  if (
    input.history !== null &&
    !history.perFileHistory &&
    fetched > 0 &&
    (fetched >= input.limits.maxCommits || detailed < fetched)
  ) {
    const fileLevel =
      detailed > 0 && detailed < fetched
        ? `; file-level activity on the latest ${formatInteger(detailed)}`
        : "";
    warnings.push({
      code: "HISTORY_LIMITED",
      message: `Activity is based on the latest ${formatInteger(fetched)} commits${fileLevel}.`,
      detail: { commits: fetched, commitsWithDetails: detailed },
    });
  }
  return warnings;
}

function normalizeWarning(warning: AnalysisWarning): AnalysisWarning {
  const normalized: AnalysisWarning = { code: warning.code, message: warning.message };
  if (warning.detail) normalized.detail = sortRecordKeys(warning.detail);
  return normalized;
}

/** Input warnings win over derived ones with the same code; output is in display order. */
export function mergeWarnings(
  provided: readonly AnalysisWarning[],
  derived: readonly AnalysisWarning[],
): AnalysisWarning[] {
  const rank = (code: AnalysisWarningCode): number => {
    const index = WARNING_ORDER.indexOf(code);
    return index === -1 ? WARNING_ORDER.length : index;
  };
  const byCode = new Map<AnalysisWarningCode, AnalysisWarning>();
  const sortedProvided = [...provided].sort(
    (a, b) =>
      rank(a.code) - rank(b.code) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.message, b.message),
  );
  for (const warning of [...sortedProvided, ...derived]) {
    if (!byCode.has(warning.code)) byCode.set(warning.code, normalizeWarning(warning));
  }
  return [...byCode.values()].sort(
    (a, b) => rank(a.code) - rank(b.code) || compareStrings(a.code, b.code),
  );
}

export function buildReport(report: ReportInput): AnalysisReport {
  const { input } = report;
  const statuses = countStatuses(report.files);
  const coverage: AnalysisCoverage = {
    filesInRepository: input.inventory.files.length,
    filesInGraph: report.files.length,
    directoriesInRepository: report.directoryCount,
    bytesInRepository: input.inventory.totalBytes,
    filesParsed: statuses.parsed,
    filesPartial: statuses.partial,
    filesContentOnly: statuses["content-only"],
    filesMetadataOnly: statuses["metadata-only"],
    filesBinary: statuses.binary,
    filesFailed: statuses.failed,
    bytesDownloaded: Number.isFinite(input.bytesDownloaded)
      ? Math.max(0, input.bytesDownloaded)
      : 0,
    symbolsExtracted: report.symbolCount,
    importsFound: report.importStats.importsFound,
    importsResolved: report.importStats.importsResolved,
    externalImports: report.importStats.externalImports,
    unresolvedImports: report.importStats.unresolvedImports,
  };
  const unsupported = unsupportedLanguagesOf(input);
  const timings: Record<string, number> = {};
  for (const [stage, duration] of Object.entries(input.timings)) {
    if (Number.isFinite(duration)) timings[stage] = duration;
  }

  const analysis: AnalysisReport = {
    tier: input.tier,
    generatedAt: safeIso(input.finishedAt),
    durationMs: Math.max(0, Math.round(input.finishedAt - input.startedAt) || 0),
    timings: sortRecordKeys(timings),
    coverage,
    treeTruncated: input.inventory.truncated,
    limits: snapshotLimits(input.limits),
    warnings: mergeWarnings(input.warnings, deriveWarnings(report, coverage, unsupported)),
    unsupportedLanguages: unsupported,
    history: report.history,
    cached: input.cached ?? false,
    analyzerVersion: input.analyzerVersion,
  };
  if (input.rateLimit) analysis.rateLimit = { ...input.rateLimit };
  return analysis;
}
