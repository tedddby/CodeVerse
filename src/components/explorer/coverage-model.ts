import type { AnalysisReport, AnalysisTier, AnalysisWarningCode } from "@/graph/model/types";
import { formatInteger, formatRelativeTime, pluralize } from "@/lib/utils/format";

/**
 * Honest summary of how much of a repository was actually analysed. The
 * explorer must never imply full coverage when limits applied.
 */

export const TIER_LABELS: Record<AnalysisTier, string> = {
  full: "Full analysis",
  progressive: "Progressive analysis",
  "directory-first": "Structure-first analysis",
};

export const TIER_DESCRIPTIONS: Record<AnalysisTier, string> = {
  full: "Every eligible source file was downloaded and parsed.",
  progressive: "A prioritized subset of source files was parsed; the rest shows structure and size only.",
  "directory-first": "Very large repository: the structure is complete, but only a small sample of files was parsed.",
};

/** Warning codes that mean the 3D world does not show everything. */
const LIMITING_WARNINGS: ReadonlySet<AnalysisWarningCode> = new Set([
  "TREE_TRUNCATED",
  "FILE_NODE_LIMIT",
  "PARSE_LIMIT",
  "BYTE_LIMIT",
  "LARGE_REPOSITORY",
]);

export interface CoverageRow {
  label: string;
  value: string;
}

export interface CoverageSummary {
  tierLabel: string;
  tierDescription: string;
  /** "Parsed 1,500 of 12,482 files". */
  headline: string;
  /** True only when nothing was left out by limits. */
  complete: boolean;
  rows: CoverageRow[];
  /** User-facing notices (warnings, truncation, unsupported languages, history). */
  notices: string[];
}

export function buildCoverageSummary(analysis: AnalysisReport, now: number = Date.now()): CoverageSummary {
  const { coverage } = analysis;
  const parsed = coverage.filesParsed + coverage.filesPartial;
  const totalLabel = `${formatInteger(coverage.filesInRepository)}${analysis.treeTruncated ? "+" : ""}`;
  const headline = `Parsed ${formatInteger(parsed)} of ${totalLabel} ${coverage.filesInRepository === 1 && !analysis.treeTruncated ? "file" : "files"}`;

  const limited =
    analysis.tier !== "full" ||
    analysis.treeTruncated ||
    coverage.filesMetadataOnly > 0 ||
    coverage.filesInGraph < coverage.filesInRepository ||
    analysis.warnings.some((warning) => LIMITING_WARNINGS.has(warning.code));

  const rows: CoverageRow[] = [
    { label: "Files in repository", value: totalLabel },
    { label: "Files in the 3D world", value: formatInteger(coverage.filesInGraph) },
    { label: "Parsed", value: formatInteger(coverage.filesParsed) },
  ];
  if (coverage.filesPartial > 0) rows.push({ label: "Partially parsed", value: formatInteger(coverage.filesPartial) });
  if (coverage.filesContentOnly > 0) rows.push({ label: "Counted, no parser", value: formatInteger(coverage.filesContentOnly) });
  if (coverage.filesMetadataOnly > 0) rows.push({ label: "Size only (not downloaded)", value: formatInteger(coverage.filesMetadataOnly) });
  if (coverage.filesBinary > 0) rows.push({ label: "Binary", value: formatInteger(coverage.filesBinary) });
  if (coverage.filesFailed > 0) rows.push({ label: "Failed", value: formatInteger(coverage.filesFailed) });
  rows.push({ label: "Symbols extracted", value: formatInteger(coverage.symbolsExtracted) });
  const internalImports = coverage.importsFound - coverage.externalImports;
  if (coverage.importsFound > 0) {
    rows.push({
      label: "Internal imports resolved",
      value: `${formatInteger(coverage.importsResolved)} of ${formatInteger(Math.max(internalImports, coverage.importsResolved))}`,
    });
  }
  if (analysis.history.commitsFetched > 0) {
    rows.push({ label: "Commits analysed", value: formatInteger(analysis.history.commitsFetched) });
  }
  rows.push({
    label: "Analysed",
    value: `${formatRelativeTime(analysis.generatedAt, now)}${analysis.cached ? " (cached)" : ""}`,
  });

  const notices: string[] = [];
  const add = (notice: string) => {
    if (notice && !notices.includes(notice)) notices.push(notice);
  };
  for (const warning of analysis.warnings) add(warning.message);
  const codes = new Set(analysis.warnings.map((warning) => warning.code));
  if (analysis.treeTruncated && !codes.has("TREE_TRUNCATED")) {
    add("GitHub truncated the file listing for this repository, so some files are missing from the world.");
  }
  if (analysis.unsupportedLanguages.length > 0 && !codes.has("UNSUPPORTED_LANGUAGES")) {
    const listed = analysis.unsupportedLanguages
      .slice()
      .sort((a, b) => b.files - a.files)
      .slice(0, 4)
      .map((language) => `${language.name} (${pluralize(language.files, "file")})`)
      .join(", ");
    const more = analysis.unsupportedLanguages.length > 4 ? ` and ${analysis.unsupportedLanguages.length - 4} more` : "";
    add(`No parser yet for ${listed}${more}: those files show size and line counts only.`);
  }
  if (analysis.history.commitsFetched === 0 && !codes.has("HISTORY_UNAVAILABLE")) {
    add("Commit history was not available, so activity and contributor views are empty.");
  } else if (!analysis.history.perFileHistory && analysis.history.commitsFetched > 0 && !codes.has("HISTORY_LIMITED")) {
    add(`Activity is based on the ${pluralize(analysis.history.commitsFetched, "most recent commit")}.`);
  }

  return {
    tierLabel: TIER_LABELS[analysis.tier],
    tierDescription: TIER_DESCRIPTIONS[analysis.tier],
    headline,
    complete: !limited,
    rows,
    notices,
  };
}
