import type { GraphIndex } from "@/graph/model/graph-index";
import { toResult, type SearchEntry, type SearchResult } from "./search-entries";

/** Empty-query suggestions: the most-connected (or largest) files and the largest directories. */

const SUGGESTED_DIRECTORIES = 5;
const SUGGESTED_FILES = 8;

/** Keeps the `limit` best items according to `better` (O(n · limit), no full sort). */
function topK<T>(items: Iterable<T>, limit: number, better: (a: T, b: T) => boolean): T[] {
  const top: T[] = [];
  for (const item of items) {
    const last = top[top.length - 1];
    if (top.length >= limit && last !== undefined && !better(item, last)) continue;
    let at = top.length;
    while (at > 0) {
      const previous = top[at - 1];
      if (previous === undefined || !better(item, previous)) break;
      at -= 1;
    }
    top.splice(at, 0, item);
    if (top.length > limit) top.pop();
  }
  return top;
}

export function buildSuggestions(
  index: GraphIndex,
  entries: readonly SearchEntry[],
): SearchResult[] {
  const degree = (id: string) =>
    (index.dependenciesBySource.get(id)?.length ?? 0) +
    (index.dependenciesByTarget.get(id)?.length ?? 0);

  const files = topK(
    index.graph.files
      .filter((file) => !file.isGenerated)
      .map((file) => ({ file, degree: degree(file.id) })),
    SUGGESTED_FILES,
    (a, b) =>
      a.degree !== b.degree
        ? a.degree > b.degree
        : a.file.lines !== b.file.lines
          ? a.file.lines > b.file.lines
          : a.file.path < b.file.path,
  ).map(({ file }) => file.id);

  const directories = topK(
    index.graph.directories.filter((directory) => directory.path !== "" && directory.depth <= 2),
    SUGGESTED_DIRECTORIES,
    (a, b) =>
      a.stats.fileCount !== b.stats.fileCount
        ? a.stats.fileCount > b.stats.fileCount
        : a.path < b.path,
  ).map((directory) => directory.id);

  const wanted = new Set([...files, ...directories]);
  const found = new Map<string, SearchEntry>();
  for (const entry of entries) {
    if (entry.kind !== "symbol" && wanted.has(entry.id)) found.set(entry.id, entry);
  }

  const suggestions: SearchResult[] = [];
  let rank = files.length + directories.length;
  for (const id of [...files, ...directories]) {
    const entry = found.get(id);
    if (entry) suggestions.push(toResult(entry, rank, []));
    rank -= 1;
  }
  return suggestions;
}

/**
 * Why files are suggested: by internal dependency count, or by size when the
 * repository has no resolved internal imports.
 */
export function fileSuggestionBasis(index: GraphIndex): "connections" | "size" {
  return index.graph.dependencies.length > 0 ? "connections" : "size";
}
