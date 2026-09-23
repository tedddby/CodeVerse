import type { RateLimitSnapshot, RepositoryInfo, RepositoryProvider } from "@/graph/model/types";
import { sleep, throwIfAborted } from "@/github/async";
import { classifyContent } from "@/github/content";
import { sanitizeRepositoryPath } from "@/github/paths";
import {
  SourceError,
  type HistoryOptions,
  type ReadFileOptions,
  type RepositorySource,
  type SourceCapabilities,
  type SourceCommit,
  type SourceCommitCountBucket,
  type SourceCommitDetails,
  type SourceContributor,
  type SourceFileActivity,
  type SourceFileResult,
  type SourceSnapshot,
  type SourceTree,
  type SourceTreeEntry,
} from "@/sources/types";
import {
  contentSha,
  deriveCommitCounts,
  deriveContributors,
  deriveFileActivity,
  sortContributors,
  toSourceCommit,
} from "./memory-history";

/** File content: text, a binary marker, or a file whose reads fail (simulated upstream error). */
export type MemoryFileSpec =
  string | { binary: true; size?: number } | { unreadable: true; size: number };

export interface MemorySourceSpec {
  repository: { owner: string; name: string } & Partial<RepositoryInfo>;
  files: Record<string, MemoryFileSpec>;
  /** Newest first. */
  commits?: SourceCommitDetails[];
  contributors?: SourceContributor[];
  truncated?: boolean;
  capabilities?: Partial<SourceCapabilities>;
  fileActivity?: Record<string, SourceFileActivity>;
  commitCounts?: SourceCommitCountBucket[];
  /** Simulated latency for `readFile`, in milliseconds. */
  readDelayMs?: number;
  rateLimit?: RateLimitSnapshot;
}

/** Size reported for binary markers without an explicit size. */
export const DEFAULT_BINARY_SIZE = 1024;

type StoredFile =
  | { kind: "text"; bytes: Uint8Array }
  | { kind: "binary"; size: number }
  | { kind: "unreadable"; size: number };

function storeFile(spec: MemoryFileSpec, encoder: TextEncoder): StoredFile {
  if (typeof spec === "string") return { kind: "text", bytes: encoder.encode(spec) };
  const size = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  if ("unreadable" in spec) return { kind: "unreadable", size: size(spec.size, 0) };
  return { kind: "binary", size: size(spec.size, DEFAULT_BINARY_SIZE) };
}

function storedSize(file: StoredFile): number {
  return file.kind === "text" ? file.bytes.length : file.size;
}

/**
 * Deterministic, fully in-memory `RepositorySource`. Used by pipeline
 * integration tests and as the basis for local-folder / archive ingestion.
 * Paths go through the same sanitizer as every other provider; invalid paths
 * are dropped (and counted in `listTree().rejectedEntries`).
 *
 * `getFileActivity` / `getCommitCounts` exist only when the corresponding
 * capability is enabled, mirroring providers that cannot offer them.
 */
export class MemorySource implements RepositorySource {
  readonly provider: RepositoryProvider;
  readonly capabilities: SourceCapabilities;
  readonly getFileActivity?: (
    snapshot: SourceSnapshot,
    paths: string[],
    signal?: AbortSignal,
  ) => Promise<Map<string, SourceFileActivity>>;
  readonly getCommitCounts?: (
    snapshot: SourceSnapshot,
    ranges: Array<{ start: string; end: string }>,
    signal?: AbortSignal,
  ) => Promise<SourceCommitCountBucket[]>;

  readonly #files = new Map<string, StoredFile>();
  readonly #rejectedEntries: number;
  readonly #snapshot: SourceSnapshot;
  readonly #commits: SourceCommitDetails[];
  readonly #spec: MemorySourceSpec;

  constructor(spec: MemorySourceSpec) {
    this.#spec = spec;
    this.provider = spec.repository.provider ?? "local";
    const encoder = new TextEncoder();
    let rejected = 0;
    for (const [rawPath, fileSpec] of Object.entries(spec.files)) {
      const path = sanitizeRepositoryPath(rawPath);
      if (path === null) rejected += 1;
      else this.#files.set(path, storeFile(fileSpec, encoder));
    }
    this.#rejectedEntries = rejected;
    this.#commits = structuredClone(spec.commits ?? []).map((commit) => ({
      ...commit,
      files: commit.files.filter((path) => sanitizeRepositoryPath(path) !== null),
    }));
    this.#snapshot = { repository: this.#buildRepository() };

    this.capabilities = {
      fileHistory: spec.capabilities?.fileHistory ?? spec.fileActivity !== undefined,
      commitCounts: spec.capabilities?.commitCounts ?? spec.commitCounts !== undefined,
    };
    if (this.capabilities.fileHistory) {
      this.getFileActivity = async (_snapshot, paths, signal) => this.#fileActivity(paths, signal);
    }
    if (this.capabilities.commitCounts) {
      this.getCommitCounts = async (_snapshot, ranges, signal) => {
        throwIfAborted(signal);
        return deriveCommitCounts(ranges, this.#commits, this.#spec.commitCounts);
      };
    }
  }

  async getSnapshot(signal?: AbortSignal): Promise<SourceSnapshot> {
    throwIfAborted(signal);
    return structuredClone(this.#snapshot);
  }

  async listTree(
    _snapshot: SourceSnapshot,
    signal?: AbortSignal,
  ): Promise<SourceTree & { rejectedEntries: number }> {
    throwIfAborted(signal);
    const entries: SourceTreeEntry[] = [...this.#files.entries()]
      .map(([path, file]) => ({ path, type: "file" as const, size: storedSize(file) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {
      entries,
      truncated: this.#spec.truncated ?? false,
      rejectedEntries: this.#rejectedEntries,
    };
  }

  async readFile(
    _snapshot: SourceSnapshot,
    path: string,
    options: ReadFileOptions,
  ): Promise<SourceFileResult> {
    throwIfAborted(options.signal);
    if (this.#spec.readDelayMs && this.#spec.readDelayMs > 0)
      await sleep(this.#spec.readDelayMs, options.signal);
    const safePath = sanitizeRepositoryPath(path);
    const file = safePath === null ? undefined : this.#files.get(safePath);
    if (!file) return { kind: "missing" };
    if (file.kind === "unreadable") {
      throw new SourceError("UPSTREAM_ERROR", "The file could not be read (simulated failure).");
    }
    const size = storedSize(file);
    if (size > Math.max(0, options.maxBytes)) return { kind: "too-large", size };
    if (file.kind === "binary") return { kind: "binary", size };
    return classifyContent(file.bytes);
  }

  async listCommits(_snapshot: SourceSnapshot, options: HistoryOptions): Promise<SourceCommit[]> {
    throwIfAborted(options.signal);
    const limit = Number.isFinite(options.maxCommits)
      ? Math.max(0, Math.floor(options.maxCommits))
      : 0;
    return this.#commits.slice(0, limit).map(toSourceCommit);
  }

  async getCommitDetails(
    _snapshot: SourceSnapshot,
    sha: string,
    signal?: AbortSignal,
  ): Promise<SourceCommitDetails> {
    throwIfAborted(signal);
    const commit = this.#commits.find(
      (candidate) => candidate.sha.toLowerCase() === sha.toLowerCase(),
    );
    if (!commit)
      throw new SourceError("NOT_FOUND", "The commit does not exist in this repository.");
    return structuredClone(commit);
  }

  async listContributors(
    _snapshot: SourceSnapshot,
    signal?: AbortSignal,
  ): Promise<SourceContributor[]> {
    throwIfAborted(signal);
    if (this.#spec.contributors) return sortContributors(structuredClone(this.#spec.contributors));
    return deriveContributors(this.#commits, (login) =>
      this.provider === "github" ? `https://github.com/${encodeURIComponent(login)}` : undefined,
    );
  }

  getRateLimit(): RateLimitSnapshot | undefined {
    return this.#spec.rateLimit ? { ...this.#spec.rateLimit } : undefined;
  }

  #fileActivity(paths: readonly string[], signal?: AbortSignal): Map<string, SourceFileActivity> {
    throwIfAborted(signal);
    const wanted = new Set(paths.filter((path) => sanitizeRepositoryPath(path) !== null));
    const result = new Map<string, SourceFileActivity>();
    const explicit = this.#spec.fileActivity;
    const remaining = new Set<string>();
    for (const path of wanted) {
      const entry = explicit && Object.hasOwn(explicit, path) ? explicit[path] : undefined;
      if (entry) result.set(path, { ...entry });
      else remaining.add(path);
    }
    for (const [path, entry] of deriveFileActivity(this.#commits, remaining))
      result.set(path, entry);
    return result;
  }

  #buildRepository(): RepositoryInfo {
    const spec = this.#spec.repository;
    const fullName = spec.fullName ?? `${spec.owner}/${spec.name}`;
    const defaultBranch = spec.defaultBranch ?? "main";
    const parts = [...this.#files.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([path, file]) => [
        path,
        file.kind === "text" ? new TextDecoder().decode(file.bytes) : `${file.kind}:${file.size}`,
      ]);
    return {
      id: `${this.provider}:${fullName}`,
      url: this.provider === "github" ? `https://github.com/${fullName}` : "",
      stars: 0,
      forks: 0,
      topics: [],
      ...spec,
      provider: this.provider,
      fullName,
      defaultBranch,
      ref: spec.ref ?? defaultBranch,
      commitSha: spec.commitSha ?? contentSha(parts),
    };
  }
}
