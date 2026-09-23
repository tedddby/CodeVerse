import type {
  AnalysisTier,
  AnalysisWarning,
  FileAnalysisStatus,
  RateLimitSnapshot,
  RepositoryInfo,
  TimelineGranularity,
} from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { ParseResult } from "@/parser/types";
import type {
  SourceCommit,
  SourceCommitCountBucket,
  SourceCommitDetails,
  SourceContributor,
  SourceFileActivity,
} from "@/sources/types";
import type { DependencyResolutionResult } from "../dependencies";
import type { FetchPlan } from "../fetch-plan";
import type { FileInventory } from "../inventory";

/** What the pipeline learned about one graph file. */
export interface FileAnalysisResult {
  status: FileAnalysisStatus;
  /** User-facing explanation for non-"parsed" statuses (a default is derived when omitted). */
  statusReason?: string;
  /** Exact line count when the content was downloaded. */
  lines?: number;
  parse?: ParseResult;
}

export interface HistoryInput {
  /** Most recent commits (any order; they are sorted newest first). */
  commits: SourceCommit[];
  /** Commits whose changed files were fetched. */
  details: SourceCommitDetails[];
  contributors: SourceContributor[];
  /** Per-file last-commit lookups (only when the provider supports them). */
  fileActivity: ReadonlyMap<string, SourceFileActivity>;
  /** Exact commit counts over the repository lifetime, when available. */
  commitCounts: { granularity: TimelineGranularity; buckets: SourceCommitCountBucket[] } | null;
  /** Whether `fileActivity` came from a dedicated per-file history lookup. */
  perFileHistory: boolean;
}

export interface AssembleInput {
  repository: RepositoryInfo;
  inventory: FileInventory;
  graphFiles: ReadonlySet<string>;
  tier: AnalysisTier;
  fetchPlan: FetchPlan | null;
  /**
   * By path. Graph files without an entry are "binary" when detected as binary,
   * otherwise "metadata-only" with the reason from `fetchPlan.skipped`.
   */
  analyses: ReadonlyMap<string, FileAnalysisResult>;
  dependencies: DependencyResolutionResult | null;
  history: HistoryInput | null;
  limits: AnalysisLimits;
  /** Warnings raised by the pipeline; they win over derived warnings with the same code. */
  warnings: AnalysisWarning[];
  /** Stage durations in milliseconds. */
  timings: Record<string, number>;
  rateLimit?: RateLimitSnapshot;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds; becomes `analysis.generatedAt`. */
  finishedAt: number;
  analyzerVersion: string;
  bytesDownloaded: number;
  cached?: boolean;
}

export type PreviewInput = Pick<
  AssembleInput,
  | "repository"
  | "inventory"
  | "graphFiles"
  | "tier"
  | "limits"
  | "startedAt"
  | "finishedAt"
  | "analyzerVersion"
  | "warnings"
  | "timings"
>;
