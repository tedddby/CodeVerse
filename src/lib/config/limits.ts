import { z } from "zod";
import type { AnalysisLimitsSnapshot } from "@/graph/model/types";

/**
 * Analysis limits. Every value can be overridden through environment variables
 * (see .env.example) so self-hosters can trade depth for speed/API usage.
 */
export interface AnalysisLimits extends AnalysisLimitsSnapshot {
  /** Hard ceiling on bytes read for any single remote file (defense in depth). */
  absoluteMaxFileBytes: number;
  /** Per-file parse timeout. */
  parseTimeoutMs: number;
  /** Concurrent content downloads. */
  fetchConcurrency: number;
  /** Timeout for a single upstream HTTP request. */
  requestTimeoutMs: number;
  /** Overall budget for one analysis; later stages degrade when it is exceeded. */
  analysisBudgetMs: number;
  /** Maximum files whose per-file history is looked up (GraphQL, token required). */
  maxFileHistoryLookups: number;
  /** Maximum bytes of a file served by the source viewer. */
  maxSourceViewerBytes: number;
  /** Maximum tree entries accepted from the provider before we stop reading. */
  maxTreeEntries: number;
  /** Maximum path length accepted from the provider. */
  maxPathLength: number;
}

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxFiles: 25_000,
  maxParsedFiles: 1_500,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxParseBytes: 256 * 1024,
  maxCommits: 300,
  maxCommitDetails: 40,
  tierFullMax: 1_000,
  tierProgressiveMax: 10_000,
  absoluteMaxFileBytes: 2 * 1024 * 1024,
  parseTimeoutMs: 2_000,
  fetchConcurrency: 16,
  requestTimeoutMs: 20_000,
  analysisBudgetMs: 110_000,
  maxFileHistoryLookups: 1_200,
  maxSourceViewerBytes: 1024 * 1024,
  maxTreeEntries: 200_000,
  maxPathLength: 1_024,
};

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  CODEVERSE_MAX_FILES: positiveInt.optional(),
  CODEVERSE_MAX_PARSED_FILES: z.coerce.number().int().min(0).optional(),
  CODEVERSE_MAX_FILE_BYTES: positiveInt.optional(),
  CODEVERSE_MAX_TOTAL_BYTES: positiveInt.optional(),
  CODEVERSE_MAX_PARSE_BYTES: positiveInt.optional(),
  CODEVERSE_PARSE_TIMEOUT_MS: positiveInt.optional(),
  CODEVERSE_FETCH_CONCURRENCY: positiveInt.max(64).optional(),
  CODEVERSE_MAX_COMMITS: z.coerce.number().int().min(0).max(5_000).optional(),
  CODEVERSE_MAX_COMMIT_DETAILS: z.coerce.number().int().min(0).max(500).optional(),
  CODEVERSE_TIER_FULL_MAX: positiveInt.optional(),
  CODEVERSE_TIER_PROGRESSIVE_MAX: positiveInt.optional(),
});

type Env = Record<string, string | undefined>;

/** Reads limits from environment variables, ignoring invalid values (with a warning). */
export function loadLimits(env: Env = process.env): AnalysisLimits {
  // Treat empty strings as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => key.startsWith("CODEVERSE_") && value !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    console.warn(
      "[codeverse] ignoring invalid analysis limit configuration:",
      parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    );
    return { ...DEFAULT_LIMITS };
  }
  const e = parsed.data;
  const limits: AnalysisLimits = {
    ...DEFAULT_LIMITS,
    maxFiles: e.CODEVERSE_MAX_FILES ?? DEFAULT_LIMITS.maxFiles,
    maxParsedFiles: e.CODEVERSE_MAX_PARSED_FILES ?? DEFAULT_LIMITS.maxParsedFiles,
    maxFileBytes: e.CODEVERSE_MAX_FILE_BYTES ?? DEFAULT_LIMITS.maxFileBytes,
    maxTotalBytes: e.CODEVERSE_MAX_TOTAL_BYTES ?? DEFAULT_LIMITS.maxTotalBytes,
    maxParseBytes: e.CODEVERSE_MAX_PARSE_BYTES ?? DEFAULT_LIMITS.maxParseBytes,
    parseTimeoutMs: e.CODEVERSE_PARSE_TIMEOUT_MS ?? DEFAULT_LIMITS.parseTimeoutMs,
    fetchConcurrency: e.CODEVERSE_FETCH_CONCURRENCY ?? DEFAULT_LIMITS.fetchConcurrency,
    maxCommits: e.CODEVERSE_MAX_COMMITS ?? DEFAULT_LIMITS.maxCommits,
    maxCommitDetails: e.CODEVERSE_MAX_COMMIT_DETAILS ?? DEFAULT_LIMITS.maxCommitDetails,
    tierFullMax: e.CODEVERSE_TIER_FULL_MAX ?? DEFAULT_LIMITS.tierFullMax,
    tierProgressiveMax: e.CODEVERSE_TIER_PROGRESSIVE_MAX ?? DEFAULT_LIMITS.tierProgressiveMax,
  };
  // Keep invariants sane regardless of configuration.
  limits.maxFileBytes = Math.min(limits.maxFileBytes, limits.absoluteMaxFileBytes);
  limits.maxParseBytes = Math.min(limits.maxParseBytes, limits.maxFileBytes);
  limits.tierProgressiveMax = Math.max(limits.tierProgressiveMax, limits.tierFullMax);
  limits.maxCommitDetails = Math.min(limits.maxCommitDetails, limits.maxCommits);
  return limits;
}

export function snapshotLimits(limits: AnalysisLimits): AnalysisLimitsSnapshot {
  return {
    maxFiles: limits.maxFiles,
    maxParsedFiles: limits.maxParsedFiles,
    maxFileBytes: limits.maxFileBytes,
    maxTotalBytes: limits.maxTotalBytes,
    maxParseBytes: limits.maxParseBytes,
    maxCommits: limits.maxCommits,
    maxCommitDetails: limits.maxCommitDetails,
    tierFullMax: limits.tierFullMax,
    tierProgressiveMax: limits.tierProgressiveMax,
  };
}
