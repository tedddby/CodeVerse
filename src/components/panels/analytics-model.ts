import { ANALYSIS_STAGES, STAGE_LABELS } from "@/analysis/protocol";
import type { GraphIndex } from "@/graph/model/graph-index";
import type {
  AnalysisTier,
  AnalysisWarning,
  ExternalPackage,
  FileNode,
  HistorySummary,
  LanguageStat,
  RepositoryGraph,
} from "@/graph/model/types";
import { isParseableLanguage } from "@/lib/languages/registry";
import { formatInteger } from "@/lib/utils/format";

/** Pure derivations behind the analytics panel and the accessible summary. */

export interface RepositoryStats {
  stars: number;
  forks: number;
  filesInRepository: number;
  /** Files whose content was downloaded and analysed (parsed, partial or line-counted). */
  filesAnalysed: number;
  filesParsed: number;
  linesOfCode: number;
  linesEstimated: boolean;
  symbols: number;
  dependencies: number;
  externalPackages: number;
  contributors: number;
}

export function repositoryStats(index: GraphIndex): RepositoryStats {
  const { graph } = index;
  const coverage = graph.analysis.coverage;
  const root = index.directoriesById.get(graph.rootDirectoryId);
  return {
    stars: graph.repository.stars,
    forks: graph.repository.forks,
    filesInRepository: coverage.filesInRepository,
    filesAnalysed: coverage.filesParsed + coverage.filesPartial + coverage.filesContentOnly,
    filesParsed: coverage.filesParsed + coverage.filesPartial,
    linesOfCode: root?.stats.totalLines ?? graph.files.reduce((sum, file) => sum + file.lines, 0),
    linesEstimated: root?.stats.linesEstimated ?? graph.files.some((file) => file.linesEstimated),
    symbols: graph.symbols.length,
    dependencies: graph.dependencies.length,
    externalPackages: graph.externalPackages.length,
    contributors: graph.contributors.length,
  };
}

export interface LanguageSegment {
  id: string;
  name: string;
  color: string;
  share: number;
  bytes: number;
  files: number;
  parseable: boolean;
}

/**
 * Languages by share of bytes. Beyond `maxSegments` the tail is folded into a
 * single "Other" segment so the stacked bar stays legible.
 */
export function languageSegments(
  languages: readonly LanguageStat[],
  maxSegments = 8,
): LanguageSegment[] {
  const sorted = [...languages]
    .filter((language) => language.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
  const total = sorted.reduce((sum, language) => sum + language.bytes, 0);
  if (total === 0) return [];
  const toSegment = (language: LanguageStat): LanguageSegment => ({
    id: language.id,
    name: language.name,
    color: language.color,
    share: language.bytes / total,
    bytes: language.bytes,
    files: language.files,
    parseable: language.parseable,
  });
  if (sorted.length <= maxSegments) return sorted.map(toSegment);
  const head = sorted.slice(0, maxSegments - 1).map(toSegment);
  const tail = sorted.slice(maxSegments - 1);
  const tailBytes = tail.reduce((sum, language) => sum + language.bytes, 0);
  head.push({
    id: "other",
    name: `${tail.length} others`,
    color: "#4b5568",
    share: tailBytes / total,
    bytes: tailBytes,
    files: tail.reduce((sum, language) => sum + language.files, 0),
    parseable: false,
  });
  return head;
}

export function topExternalPackages(
  packages: readonly ExternalPackage[],
  limit = 10,
): ExternalPackage[] {
  return [...packages]
    .sort(
      (a, b) =>
        b.importCount - a.importCount || b.fileCount - a.fileCount || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

export function largestFiles(graph: RepositoryGraph, limit = 5): FileNode[] {
  return graph.files
    .filter((file) => !file.isGenerated && file.status !== "binary")
    .sort((a, b) => b.lines - a.lines || b.size - a.size || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export interface ConnectedFile {
  file: FileNode;
  incoming: number;
  outgoing: number;
}

/** Files with the most internal import relationships (imported-by + imports). */
export function mostConnectedFiles(index: GraphIndex, limit = 5): ConnectedFile[] {
  const result: ConnectedFile[] = [];
  for (const file of index.graph.files) {
    const incoming = index.dependenciesByTarget.get(file.id)?.length ?? 0;
    const outgoing = index.dependenciesBySource.get(file.id)?.length ?? 0;
    if (incoming + outgoing > 0) result.push({ file, incoming, outgoing });
  }
  return result
    .sort(
      (a, b) =>
        b.incoming + b.outgoing - (a.incoming + a.outgoing) ||
        b.incoming - a.incoming ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, limit);
}

export interface ParseCoverage {
  /** Files successfully parsed (including partial parses). */
  parsed: number;
  /** Files in the graph written in a parseable language (excluding generated code). */
  eligible: number;
  /** parsed / eligible, 0..1 (1 when nothing is eligible). */
  share: number;
}

export function parseCoverage(graph: RepositoryGraph): ParseCoverage {
  let parsed = 0;
  let eligible = 0;
  for (const file of graph.files) {
    if (!isParseableLanguage(file.language) || file.isGenerated || file.status === "binary")
      continue;
    eligible += 1;
    if (file.status === "parsed" || file.status === "partial") parsed += 1;
  }
  return { parsed, eligible, share: eligible === 0 ? 1 : parsed / eligible };
}

export const TIER_COPY: Record<AnalysisTier, { label: string; description: string }> = {
  full: { label: "Full analysis", description: "Every eligible file was downloaded and parsed." },
  progressive: {
    label: "Progressive",
    description: "A prioritized subset was parsed; remaining files are shown from metadata only.",
  },
  "directory-first": {
    label: "Directory-first",
    description: "Very large repository: structure first, with a small parsed sample.",
  },
};

/** Why the history stage limited commit history (`detail.reason` of a HISTORY_LIMITED warning). */
export type HistoryLimitReason = "time-budget" | "low-quota" | "unauthenticated";

const HISTORY_LIMIT_REASONS: Record<HistoryLimitReason, string> = {
  unauthenticated: "no GitHub token configured",
  "low-quota": "GitHub API quota running low",
  "time-budget": "analysis time budget reached",
};

function isHistoryLimitReason(value: unknown): value is HistoryLimitReason {
  return typeof value === "string" && Object.hasOwn(HISTORY_LIMIT_REASONS, value);
}

/** "the latest commit", "the latest 40 commits". */
export function latestCommits(count: number): string {
  return count === 1 ? "the latest commit" : `the latest ${formatInteger(count)} commits`;
}

/**
 * Short account of a HISTORY_LIMITED warning: why history was limited, when
 * the pipeline recorded a reason, and what the activity views cover, e.g.
 * "History limited: no GitHub token configured. Activity covers the latest 100
 * commits, with file changes from the latest 20 commits." Counts come from the
 * warning's detail, falling back to the history summary.
 */
export function historyLimitExplanation(warning: AnalysisWarning, history: HistorySummary): string {
  const detail = warning.detail ?? {};
  const commits = typeof detail.commits === "number" ? detail.commits : history.commitsFetched;
  const detailed =
    typeof detail.commitsWithDetails === "number"
      ? detail.commitsWithDetails
      : history.commitsWithDetails;
  const reason = isHistoryLimitReason(detail.reason)
    ? `History limited: ${HISTORY_LIMIT_REASONS[detail.reason]}.`
    : "History limited.";
  if (commits === 0) return `${reason} No commits were read.`;
  const files =
    detailed >= commits
      ? ""
      : detailed === 0
        ? ", without file changes"
        : `, with file changes from ${latestCommits(detailed)}`;
  return `${reason} Activity covers ${latestCommits(commits)}${files}.`;
}

export interface StageTiming {
  id: string;
  label: string;
  ms: number;
}

/** Stage timings in pipeline order; unknown stage ids follow in their original order. */
export function stageTimings(timings: Readonly<Record<string, number>>): StageTiming[] {
  const known: readonly string[] = ANALYSIS_STAGES;
  const labels: Readonly<Record<string, string>> = STAGE_LABELS;
  const ordered = [
    ...ANALYSIS_STAGES.filter((stage) => stage in timings),
    ...Object.keys(timings).filter((stage) => !known.includes(stage)),
  ];
  return ordered
    .map((id) => ({ id, label: labels[id] ?? id, ms: timings[id] ?? 0 }))
    .filter((timing) => Number.isFinite(timing.ms) && timing.ms >= 0);
}

/** 1234 -> "1.2 s", 87 -> "87 ms". */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}

/** Only absolute https URLs are rendered as links (repository data is untrusted). */
export function safeHttpsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
