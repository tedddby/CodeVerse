import type {
  CommitNode,
  ContributorNode,
  DependencyEdge,
  DirectoryNode,
  FileNode,
  RepositoryGraph,
  SymbolNode,
} from "./types";

/**
 * Read-only lookup structures derived from a RepositoryGraph.
 * Built once per graph (O(n)) and shared by the store, renderer, search and panels.
 */
export interface GraphIndex {
  graph: RepositoryGraph;
  directoriesById: Map<string, DirectoryNode>;
  filesById: Map<string, FileNode>;
  filesByPath: Map<string, FileNode>;
  symbolsById: Map<string, SymbolNode>;
  contributorsById: Map<string, ContributorNode>;
  commitsBySha: Map<string, CommitNode>;
  /** Outgoing dependency edges keyed by importer file id. */
  dependenciesBySource: Map<string, DependencyEdge[]>;
  /** Incoming dependency edges keyed by imported file id. */
  dependenciesByTarget: Map<string, DependencyEdge[]>;
  /** Commits that touched a file (only commits with fetched details), newest first. */
  commitsByFileId: Map<string, CommitNode[]>;
  /** Ancestor directory ids from the root down to (and including) the directory itself. */
  ancestorsOf(directoryId: string): string[];
  /** All file ids under a directory (recursive). */
  filesUnder(directoryId: string): string[];
  /** Maximum values used to normalize visual encodings. */
  maxima: {
    lines: number;
    size: number;
    symbols: number;
    dependencyDegree: number;
    commitCount: number;
  };
  /** Epoch-ms range of known file activity (for recency encodings). */
  activityRange: { min: number; max: number } | null;
}

function pushToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildGraphIndex(graph: RepositoryGraph): GraphIndex {
  const directoriesById = new Map(graph.directories.map((d) => [d.id, d] as const));
  const filesById = new Map(graph.files.map((f) => [f.id, f] as const));
  const filesByPath = new Map(graph.files.map((f) => [f.path, f] as const));
  const symbolsById = new Map(graph.symbols.map((s) => [s.id, s] as const));
  const contributorsById = new Map(graph.contributors.map((c) => [c.id, c] as const));
  const commitsBySha = new Map(graph.commits.map((c) => [c.sha, c] as const));

  const dependenciesBySource = new Map<string, DependencyEdge[]>();
  const dependenciesByTarget = new Map<string, DependencyEdge[]>();
  for (const edge of graph.dependencies) {
    pushToMap(dependenciesBySource, edge.source, edge);
    pushToMap(dependenciesByTarget, edge.target, edge);
  }

  const commitsByFileId = new Map<string, CommitNode[]>();
  for (const commit of graph.commits) {
    for (const id of commit.fileIds ?? []) pushToMap(commitsByFileId, id, commit);
  }

  let maxLines = 1;
  let maxSize = 1;
  let maxSymbols = 1;
  let maxCommitCount = 1;
  let minActivity = Number.POSITIVE_INFINITY;
  let maxActivity = Number.NEGATIVE_INFINITY;
  for (const file of graph.files) {
    if (file.lines > maxLines) maxLines = file.lines;
    if (file.size > maxSize) maxSize = file.size;
    if (file.symbolIds.length > maxSymbols) maxSymbols = file.symbolIds.length;
    const activity = file.activity;
    if (activity) {
      if (activity.commitCount > maxCommitCount) maxCommitCount = activity.commitCount;
      if (activity.lastModified) {
        const t = Date.parse(activity.lastModified);
        if (!Number.isNaN(t)) {
          if (t < minActivity) minActivity = t;
          if (t > maxActivity) maxActivity = t;
        }
      }
    }
  }

  let maxDegree = 1;
  for (const file of graph.files) {
    const degree =
      (dependenciesBySource.get(file.id)?.length ?? 0) +
      (dependenciesByTarget.get(file.id)?.length ?? 0);
    if (degree > maxDegree) maxDegree = degree;
  }

  const ancestorCache = new Map<string, string[]>();
  function ancestorsOf(directoryId: string): string[] {
    const cached = ancestorCache.get(directoryId);
    if (cached) return cached;
    const chain: string[] = [];
    let current = directoriesById.get(directoryId);
    while (current) {
      chain.push(current.id);
      current = current.parentId ? directoriesById.get(current.parentId) : undefined;
    }
    chain.reverse();
    ancestorCache.set(directoryId, chain);
    return chain;
  }

  const filesUnderCache = new Map<string, string[]>();
  function filesUnder(directoryId: string): string[] {
    const cached = filesUnderCache.get(directoryId);
    if (cached) return cached;
    const result: string[] = [];
    const stack = [directoryId];
    while (stack.length > 0) {
      const id = stack.pop();
      const dir = id ? directoriesById.get(id) : undefined;
      if (!dir) continue;
      result.push(...dir.fileIds);
      stack.push(...dir.childDirectoryIds);
    }
    filesUnderCache.set(directoryId, result);
    return result;
  }

  return {
    graph,
    directoriesById,
    filesById,
    filesByPath,
    symbolsById,
    contributorsById,
    commitsBySha,
    dependenciesBySource,
    dependenciesByTarget,
    commitsByFileId,
    ancestorsOf,
    filesUnder,
    maxima: {
      lines: maxLines,
      size: maxSize,
      symbols: maxSymbols,
      dependencyDegree: maxDegree,
      commitCount: maxCommitCount,
    },
    activityRange:
      Number.isFinite(minActivity) && Number.isFinite(maxActivity)
        ? { min: minActivity, max: maxActivity }
        : null,
  };
}
