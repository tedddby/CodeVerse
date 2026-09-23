/**
 * The normalized, provider-agnostic repository model.
 *
 * Everything downstream of ingestion (layout, rendering, search, panels) consumes
 * a `RepositoryGraph` and never talks to GitHub (or any other provider) directly.
 * A graph produced from GitHub, GitLab, a local folder or a ZIP upload must be
 * indistinguishable to the visualization engine.
 *
 * Conventions
 * - All ids are stable strings derived from paths (see `ids.ts`), so the same
 *   repository at the same commit always yields the same ids.
 * - Paths are POSIX-style, relative to the repository root, without leading "/".
 *   The root directory has path "".
 * - Line numbers are 1-based and inclusive.
 * - Dates are ISO-8601 strings (UTC).
 * - Collections are arrays (JSON-friendly). Use `buildGraphIndex()` for O(1) lookups.
 */

export const GRAPH_SCHEMA_VERSION = 1 as const;

/** Where the repository came from. The renderer must not branch on this. */
export type RepositoryProvider = "github" | "gitlab" | "local" | "archive" | "fixture";

export interface RepositoryInfo {
  /** Globally unique id, e.g. "github:facebook/react". */
  id: string;
  provider: RepositoryProvider;
  owner: string;
  name: string;
  /** "owner/name". */
  fullName: string;
  description?: string;
  /** Human-facing URL of the repository (e.g. https://github.com/facebook/react). */
  url: string;
  defaultBranch: string;
  /** Branch, tag or SHA that was requested/analysed (defaults to defaultBranch). */
  ref: string;
  /** Exact commit SHA that was analysed. Used as the cache key. */
  commitSha: string;
  stars: number;
  forks: number;
  watchers?: number;
  openIssues?: number;
  /** Primary language as reported by the provider. */
  language?: string;
  topics: string[];
  license?: string;
  homepage?: string;
  createdAt?: string;
  pushedAt?: string;
  /** Provider-reported repository size in kilobytes (includes history). */
  sizeKb?: number;
  isFork?: boolean;
  isArchived?: boolean;
}

// ─── Structure ──────────────────────────────────────────────────────────────

export interface DirectoryStats {
  /** Files anywhere below this directory that exist in the repository (including omitted ones). */
  fileCount: number;
  /** Files directly inside this directory. */
  directFileCount: number;
  /** Sub-directories directly inside this directory. */
  directDirectoryCount: number;
  /** Lines of code below this directory (sum of FileNode.lines, which may be estimated). */
  totalLines: number;
  /** True when any contributing line count is an estimate. */
  linesEstimated: boolean;
  /** Bytes below this directory. */
  totalBytes: number;
  /** Symbols extracted below this directory. */
  symbolCount: number;
  /** Files below this directory that are present in the repository but not included as FileNodes. */
  omittedFileCount: number;
  /** Language id -> bytes, recursively. */
  languageBytes: Record<string, number>;
}

export interface DirectoryNode {
  /** "dir:<path>"; the root is "dir:". */
  id: string;
  /** "" for the repository root. */
  path: string;
  /** Last path segment; the repository name for the root. */
  name: string;
  parentId: string | null;
  /** 0 for the root. */
  depth: number;
  childDirectoryIds: string[];
  /** FileNode ids directly inside this directory (only files included in the graph). */
  fileIds: string[];
  stats: DirectoryStats;
}

/** Broad role of a file, used for filtering and styling. */
export type FileCategory =
  | "source"
  | "test"
  | "docs"
  | "config"
  | "data"
  | "style"
  | "markup"
  | "asset"
  | "build"
  | "vendor"
  | "other";

/**
 * How deeply a file was analysed. The UI must surface anything other than
 * "parsed" honestly — the graph never pretends a file was analysed when it was not.
 */
export type FileAnalysisStatus =
  /** Content downloaded and AST parsed without syntax errors. */
  | "parsed"
  /** Content downloaded and parsed, but the tree contains syntax errors; extraction is best-effort. */
  | "partial"
  /** Content downloaded and lines counted, but no parser exists for the language. */
  | "content-only"
  /** Only tree metadata (path, size) is known; content was not downloaded due to limits. */
  | "metadata-only"
  /** Detected as binary; content is never parsed. */
  | "binary"
  /** Download or parsing failed; see `statusReason`. */
  | "failed";

export type ImportKind =
  /** ES `import ... from`, Python `import`/`from`, Java `import`, Go `import`, Rust `use`. */
  | "import"
  /** `import()` expressions. */
  | "dynamic-import"
  /** CommonJS `require()`. */
  | "require"
  /** `export ... from`. */
  | "re-export"
  /** `import type` (TypeScript). */
  | "type-import"
  /** Rust `mod foo;` declarations. */
  | "module";

export interface ImportRef {
  /** Raw specifier as written, e.g. "./jwt", "react", "os.path", "crate::auth::jwt". */
  specifier: string;
  kind: ImportKind;
  /** 1-based line of the import statement. */
  line: number;
  /** FileNode id this import resolved to, when it points inside the repository. */
  resolvedFileId?: string;
  /** True when the import refers to a third-party package / standard library. */
  external: boolean;
}

export interface FileActivity {
  /** Most recent commit date touching this file, when known. */
  lastModified?: string;
  /** Contributor id of the most recent commit's author, when known. */
  lastAuthorId?: string;
  /** Number of commits touching this file within the analysed history window. */
  commitCount: number;
  /** Contributor ids that touched this file within the analysed history window (most active first). */
  contributorIds: string[];
}

export interface FileNode {
  /** "file:<path>". */
  id: string;
  path: string;
  name: string;
  /** Lower-case extension without the dot ("ts", "py"), or "" if none. */
  extension: string;
  /** Language id from the language registry ("typescript", "python", ..., "unknown"). */
  language: string;
  category: FileCategory;
  /** Size in bytes. */
  size: number;
  /** Lines of code. Estimated from size when the content was not downloaded. */
  lines: number;
  linesEstimated: boolean;
  directoryId: string;
  /** SymbolNode ids declared in this file, in source order. */
  symbolIds: string[];
  imports: ImportRef[];
  /** Names exported by this file (best-effort). */
  exports: string[];
  status: FileAnalysisStatus;
  /** Human-readable explanation for non-"parsed" statuses. */
  statusReason?: string;
  /** Lockfiles, minified bundles, vendored or generated code. */
  isGenerated: boolean;
  activity?: FileActivity;
}

// ─── Symbols ────────────────────────────────────────────────────────────────

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "method"
  | "variable"
  | "constant"
  | "type"
  | "enum"
  | "struct"
  | "trait"
  | "module";

export interface SymbolNode {
  /** "sym:<path>#<name>@<startLine>". */
  id: string;
  name: string;
  kind: SymbolKind;
  fileId: string;
  /** Enclosing symbol (e.g. the class of a method). */
  parentSymbolId?: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  /** Short single-line signature, e.g. "function authenticate(token: string): User". Max ~160 chars. */
  signature?: string;
}

// ─── Relationships ──────────────────────────────────────────────────────────

/** Generic directed edge between two nodes of the graph. */
export interface Edge<K extends string = string> {
  /** "<kind>:<source>-><target>". */
  id: string;
  source: string;
  target: string;
  kind: K;
}

export type DependencyKind = "import" | "dynamic-import" | "require" | "re-export" | "type-import" | "module";

/** File-to-file dependency: `source` imports `target`. */
export interface DependencyEdge extends Edge<DependencyKind> {
  /** Number of import statements collapsed into this edge. */
  weight: number;
}

/** Third-party package / module imported by repository files. */
export interface ExternalPackage {
  /** Normalized package name ("react", "@scope/pkg", "numpy", "java.util", "fmt", "serde"). */
  name: string;
  /** Number of import statements referencing the package. */
  importCount: number;
  /** Number of distinct files importing the package. */
  fileCount: number;
  /** Language ecosystem the package belongs to (language id). */
  language: string;
}

// ─── History ────────────────────────────────────────────────────────────────

export interface CommitNode {
  sha: string;
  /** First line of the commit message only. */
  message: string;
  /** Contributor id, when the author maps to a known contributor. */
  authorId?: string;
  authorName: string;
  /** ISO date (author date). */
  date: string;
  additions?: number;
  deletions?: number;
  /** Files changed by this commit that exist in the analysed tree. Present only when details were fetched. */
  fileIds?: string[];
  /** Number of files changed (including files no longer in the tree), when details were fetched. */
  changedFileCount?: number;
  url: string;
}

export interface ContributorNode {
  /** "user:<login>" for provider accounts, "author:<normalized name>" otherwise. */
  id: string;
  login?: string;
  name: string;
  /** Only avatars from the provider's avatar CDN are kept. */
  avatarUrl?: string;
  profileUrl?: string;
  /** All-time contributions as reported by the provider (0 when unknown). */
  contributions: number;
  /** Commits authored within the analysed history window. */
  commitCount: number;
  /** FileNode ids this contributor touched within the analysed history window. */
  fileIds: string[];
}

export type TimelineGranularity = "day" | "week" | "month" | "quarter" | "year";

export interface TimelineBucket {
  /** Inclusive start, ISO date. */
  start: string;
  /** Exclusive end, ISO date. */
  end: string;
  commits: number;
}

export interface Timeline {
  granularity: TimelineGranularity;
  /**
   * "full-history": exact commit counts per bucket across the repository lifetime.
   * "sampled": derived only from the commits that were fetched (see HistorySummary).
   */
  coverage: "full-history" | "sampled";
  buckets: TimelineBucket[];
  /** ISO date of the first bucket start / last bucket end. */
  start?: string;
  end?: string;
}

export interface HistorySummary {
  /** Commits listed (most recent first). */
  commitsFetched: number;
  /** Commits whose changed-file lists were fetched. */
  commitsWithDetails: number;
  /** Files whose last-modified date is known. */
  filesWithActivity: number;
  /** Date range covered by `commits`. */
  oldestCommitDate?: string;
  newestCommitDate?: string;
  /** Whether per-file activity comes from a dedicated per-file history lookup (vs. sampled commits only). */
  perFileHistory: boolean;
}

// ─── Languages ──────────────────────────────────────────────────────────────

export interface LanguageStat {
  /** Language id from the registry. */
  id: string;
  name: string;
  /** Hex color, e.g. "#3178c6". */
  color: string;
  files: number;
  bytes: number;
  lines: number;
  /** Share of total bytes, 0..1. */
  share: number;
  /** Whether CodeVerse can AST-parse this language. */
  parseable: boolean;
}

// ─── Analysis report ────────────────────────────────────────────────────────

/**
 * - "full": small repositories; everything eligible is parsed.
 * - "progressive": medium repositories; a prioritized subset is parsed, the rest is metadata-only.
 * - "directory-first": very large repositories; structure first, only a small sample is parsed.
 */
export type AnalysisTier = "full" | "progressive" | "directory-first";

export type AnalysisWarningCode =
  | "TREE_TRUNCATED"
  | "FILE_NODE_LIMIT"
  | "PARSE_LIMIT"
  | "BYTE_LIMIT"
  | "LARGE_REPOSITORY"
  | "UNSUPPORTED_LANGUAGES"
  | "PARSE_FAILURES"
  | "FETCH_FAILURES"
  | "HISTORY_UNAVAILABLE"
  | "HISTORY_LIMITED"
  | "RATE_LIMIT_LOW"
  | "EMPTY_REPOSITORY";

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  /** User-facing sentence. */
  message: string;
  /** Optional structured details (counts, limits). */
  detail?: Record<string, string | number | boolean>;
}

export interface AnalysisLimitsSnapshot {
  maxFiles: number;
  maxParsedFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxParseBytes: number;
  maxCommits: number;
  maxCommitDetails: number;
  tierFullMax: number;
  tierProgressiveMax: number;
}

export interface AnalysisCoverage {
  /** Files present in the repository tree (after excluding submodules/symlinks). */
  filesInRepository: number;
  /** Files included as FileNodes in this graph. */
  filesInGraph: number;
  directoriesInRepository: number;
  bytesInRepository: number;
  filesParsed: number;
  filesPartial: number;
  filesContentOnly: number;
  filesMetadataOnly: number;
  filesBinary: number;
  filesFailed: number;
  bytesDownloaded: number;
  symbolsExtracted: number;
  importsFound: number;
  importsResolved: number;
  externalImports: number;
  unresolvedImports: number;
}

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  /** ISO date when the quota resets. */
  resetAt: string;
  authenticated: boolean;
}

export interface AnalysisReport {
  tier: AnalysisTier;
  /** ISO date the analysis finished. */
  generatedAt: string;
  durationMs: number;
  /** Duration of each pipeline stage in milliseconds, keyed by stage id. */
  timings: Record<string, number>;
  coverage: AnalysisCoverage;
  /** True when the provider truncated the file listing (very large repositories). */
  treeTruncated: boolean;
  limits: AnalysisLimitsSnapshot;
  warnings: AnalysisWarning[];
  /** Languages present but not AST-parseable, with file counts. */
  unsupportedLanguages: Array<{ language: string; name: string; files: number }>;
  history: HistorySummary;
  rateLimit?: RateLimitSnapshot;
  /** Whether this graph was served from cache. */
  cached: boolean;
  /** Version of the analyzer that produced the graph (bump to invalidate caches). */
  analyzerVersion: string;
}

// ─── The graph ──────────────────────────────────────────────────────────────

export interface RepositoryGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  repository: RepositoryInfo;
  rootDirectoryId: string;
  directories: DirectoryNode[];
  files: FileNode[];
  symbols: SymbolNode[];
  dependencies: DependencyEdge[];
  externalPackages: ExternalPackage[];
  commits: CommitNode[];
  contributors: ContributorNode[];
  languages: LanguageStat[];
  timeline: Timeline;
  analysis: AnalysisReport;
}

/** Any addressable node in the world. */
export type NodeKind = "directory" | "file" | "symbol";

export interface NodeRef {
  kind: NodeKind;
  id: string;
}
