import type { RateLimitSnapshot, RepositoryInfo } from "@/graph/model/types";

/**
 * Provider-agnostic ingestion contract.
 *
 * The analysis pipeline only talks to a `RepositorySource`. GitHub is the first
 * implementation; GitLab, a local folder or a ZIP upload implement the same
 * interface without touching the pipeline, graph model or renderer.
 *
 * Implementations MUST:
 * - treat every value coming from the provider as untrusted input (validate with Zod),
 * - never execute repository content,
 * - never expose credentials through return values, errors or logs,
 * - throw `SourceError` (below) for all expected failure modes.
 */

export interface SourceSnapshot {
  repository: RepositoryInfo;
}

export type SourceEntryType = "file" | "symlink" | "submodule";

export interface SourceTreeEntry {
  /** POSIX path relative to the repository root, already sanitized. */
  path: string;
  type: SourceEntryType;
  /** Size in bytes (0 when unknown). */
  size: number;
}

export interface SourceTree {
  entries: SourceTreeEntry[];
  /** True when the provider could not list every entry. */
  truncated: boolean;
  /** Entries dropped because their paths failed sanitization (unsafe or malformed). */
  rejectedEntries?: number;
}

export type SourceFileResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number }
  | { kind: "missing" };

export interface ReadFileOptions {
  /** Stop reading and return `too-large` after this many bytes. */
  maxBytes: number;
  signal?: AbortSignal;
}

export interface SourceCommit {
  sha: string;
  message: string;
  authorName: string;
  /** Provider account login of the author, when linked. */
  authorLogin?: string;
  authorAvatarUrl?: string;
  date: string;
  url: string;
}

export interface SourceCommitDetails extends SourceCommit {
  additions?: number;
  deletions?: number;
  /** Paths changed by the commit (post-change paths; renames report the new path). */
  files: string[];
}

export interface SourceContributor {
  login?: string;
  name: string;
  avatarUrl?: string;
  profileUrl?: string;
  contributions: number;
}

export interface SourceFileActivity {
  lastModified: string;
  authorLogin?: string;
  authorName?: string;
}

export interface SourceCommitCountBucket {
  start: string;
  end: string;
  commits: number;
}

export interface HistoryOptions {
  maxCommits: number;
  signal?: AbortSignal;
}

/** Capabilities differ per provider/credentials; the pipeline adapts to them. */
export interface SourceCapabilities {
  /** Whether per-file last-commit lookups are supported (GitHub GraphQL requires a token). */
  fileHistory: boolean;
  /** Whether exact commit counts per time range are available. */
  commitCounts: boolean;
}

export interface RepositorySource {
  readonly provider: RepositoryInfo["provider"];
  readonly capabilities: SourceCapabilities;

  /** Resolves repository metadata and the exact commit to analyse. */
  getSnapshot(signal?: AbortSignal): Promise<SourceSnapshot>;

  /** Lists every file in the snapshot (paths sanitized, directories omitted). */
  listTree(snapshot: SourceSnapshot, signal?: AbortSignal): Promise<SourceTree>;

  /** Reads a file's content with a hard byte cap. Never throws for missing/binary files. */
  readFile(
    snapshot: SourceSnapshot,
    path: string,
    options: ReadFileOptions,
  ): Promise<SourceFileResult>;

  /** Most recent commits on the analysed ref, newest first. */
  listCommits(snapshot: SourceSnapshot, options: HistoryOptions): Promise<SourceCommit[]>;

  /** Details (changed files) for one commit. */
  getCommitDetails(
    snapshot: SourceSnapshot,
    sha: string,
    signal?: AbortSignal,
  ): Promise<SourceCommitDetails>;

  /** Top contributors, most contributions first. */
  listContributors(snapshot: SourceSnapshot, signal?: AbortSignal): Promise<SourceContributor[]>;

  /** Last-commit info per path. Only called when `capabilities.fileHistory` is true. */
  getFileActivity?(
    snapshot: SourceSnapshot,
    paths: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, SourceFileActivity>>;

  /** Exact commit counts for the given ranges. Only called when `capabilities.commitCounts` is true. */
  getCommitCounts?(
    snapshot: SourceSnapshot,
    ranges: Array<{ start: string; end: string }>,
    signal?: AbortSignal,
  ): Promise<SourceCommitCountBucket[]>;

  /** Latest known API quota, if the provider has one. */
  getRateLimit(): RateLimitSnapshot | undefined;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export type SourceErrorCode =
  | "INVALID_REPOSITORY"
  | "NOT_FOUND"
  | "PRIVATE_OR_INACCESSIBLE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "EMPTY_REPOSITORY"
  | "REF_NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "ABORTED";

/**
 * Brand shared by every copy of this module. Bundlers may duplicate this file
 * into several server chunks, which breaks `instanceof` across them; a
 * registry symbol is the same value in every copy.
 */
const SOURCE_ERROR_BRAND: unique symbol = Symbol.for("codeverse.SourceError");

export class SourceError extends Error {
  readonly [SOURCE_ERROR_BRAND] = true;
  readonly code: SourceErrorCode;
  /** HTTP status from the provider, if any. */
  readonly status?: number;
  /** When the caller may retry (rate limits), ISO date. */
  readonly retryAt?: string;

  constructor(
    code: SourceErrorCode,
    message: string,
    options?: { status?: number; retryAt?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SourceError";
    this.code = code;
    this.status = options?.status;
    this.retryAt = options?.retryAt;
  }
}

/** Recognizes SourceErrors (and subclasses) even when they come from another bundled copy of this module. */
export function isSourceError(value: unknown): value is SourceError {
  return (
    value instanceof SourceError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { [SOURCE_ERROR_BRAND]?: unknown })[SOURCE_ERROR_BRAND] === true)
  );
}
