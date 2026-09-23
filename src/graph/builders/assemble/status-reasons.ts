import type { AnalysisTier } from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import { formatBytes, formatInteger } from "@/lib/utils/format";
import { parseBudgetFor, type SkipReason } from "../fetch-plan";

/**
 * User-facing explanations for files that were not fully analysed. Shown
 * verbatim in the file panel, so they must be short, specific and honest.
 */

export const PREVIEW_STATUS_REASON = "Analysis in progress";
export const BINARY_STATUS_REASON = "Binary file — contents are not analyzed";
export const UNPROCESSED_STATUS_REASON =
  "Not analyzed: the analysis stopped before reaching this file";

export function skipReasonMessage(
  reason: SkipReason,
  size: number,
  tier: AnalysisTier,
  limits: AnalysisLimits,
): string {
  switch (reason) {
    case "parse-limit":
      return `Not analyzed: parse limit of ${formatInteger(parseBudgetFor(tier, limits))} files reached`;
    case "size-limit":
      return size > limits.maxFileBytes
        ? `Not analyzed: larger than ${formatBytes(limits.maxFileBytes)}`
        : `Not analyzed: larger than the ${formatBytes(limits.maxParseBytes)} parse limit`;
    case "byte-budget":
      return `Not analyzed: download budget of ${formatBytes(limits.maxTotalBytes)} reached`;
    case "generated":
      return "Generated or vendored file";
    case "binary":
      return BINARY_STATUS_REASON;
    case "not-parseable":
      return "Language not supported for parsing";
    case "not-selected":
      return "Not downloaded: outside the analyzed sample for a repository of this size";
  }
}
