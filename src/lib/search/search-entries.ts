import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, SymbolKind } from "@/graph/model/types";
import { characterMask } from "./fuzzy";

/**
 * Search entries: the precomputed, query-independent keys (lower-case names and
 * paths, character masks, ranking priors) for every directory, file and symbol.
 */

export type SearchResultKind = "directory" | "file" | "symbol";

export interface SearchResult {
  ref: NodeRef;
  kind: SearchResultKind;
  /** Display title: "auth/", "auth.ts", "authenticate()", "AuthService". */
  title: string;
  /** Secondary line: containing path, or "Parent · path:line" for symbols. */
  subtitle: string;
  score: number;
  /** Matched character indices in `title`, ascending. */
  matches: number[];
  symbolKind?: SymbolKind;
  /** Language id of the file (or of the symbol's file). */
  language?: string;
}

/** Precomputed, query-independent search key for one node. */
export interface SearchEntry {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  /** Matched against first: directory/file base name or symbol name. */
  name: string;
  nameLower: string;
  /** File stem ("auth" for "auth.ts"), lower-case; "" when not applicable. */
  stemLower: string;
  /** Fallback key: full path for files/directories, "Parent.name" for nested symbols, else "". */
  path: string;
  pathLower: string;
  /** Index in `path` where `name` starts (maps path positions to title positions). */
  nameOffset: number;
  /** Static ranking prior (kind, exported, generated...) minus a small length penalty. */
  bias: number;
  /** `characterMask` of `nameLower` / `pathLower` (fast rejection). */
  nameMask: number;
  pathMask: number;
  symbolKind?: SymbolKind;
  language?: string;
}

type EntryInput = Omit<
  SearchEntry,
  "nameLower" | "pathLower" | "bias" | "nameMask" | "pathMask"
> & {
  prior: number;
};

/**
 * Precomputes the lower-case keys, masks and ranking bias of an entry. Every
 * field is always assigned (in the same order) so all entries share one object
 * shape, which keeps the search loop monomorphic.
 */
function createEntry(input: EntryInput): SearchEntry {
  const nameLower = input.name.toLowerCase();
  const pathLower = input.path.toLowerCase();
  return {
    kind: input.kind,
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    name: input.name,
    nameLower,
    stemLower: input.stemLower,
    path: input.path,
    pathLower,
    nameOffset: input.nameOffset,
    // Shorter paths win ties: a tiny penalty per character.
    bias: input.prior - (input.path.length || input.name.length) * 0.01,
    nameMask: characterMask(nameLower),
    pathMask: input.path === input.name ? characterMask(nameLower) : characterMask(pathLower),
    symbolKind: input.symbolKind,
    language: input.language,
  };
}

const CALLABLE_KINDS: ReadonlySet<SymbolKind> = new Set(["function", "method"]);

const SYMBOL_PRIORS: Record<SymbolKind, number> = {
  class: 4,
  interface: 4,
  struct: 4,
  trait: 4,
  enum: 3,
  type: 3,
  function: 3,
  module: 2,
  method: 2,
  constant: 1,
  variable: 0,
};

/** Display title of a symbol: callables get "()" so they read like code. */
export function symbolTitle(name: string, kind: SymbolKind): string {
  return CALLABLE_KINDS.has(kind) ? `${name}()` : name;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : "";
}

/** Builds one entry per directory (except the root), file and symbol. */
export function buildSearchEntries(index: GraphIndex): SearchEntry[] {
  const { graph } = index;
  const repositoryName = graph.repository.name;
  const entries: SearchEntry[] = [];

  for (const directory of graph.directories) {
    if (directory.id === graph.rootDirectoryId || directory.path === "") continue;
    const parent = directory.parentId ? index.directoriesById.get(directory.parentId) : undefined;
    entries.push(
      createEntry({
        kind: "directory",
        id: directory.id,
        title: `${directory.name}/`,
        subtitle: parent && parent.path !== "" ? `${parent.path}/` : repositoryName,
        name: directory.name,
        stemLower: "",
        path: directory.path,
        nameOffset: directory.path.length - directory.name.length,
        prior: 6,
      }),
    );
  }

  for (const file of graph.files) {
    const slash = file.path.lastIndexOf("/");
    entries.push(
      createEntry({
        kind: "file",
        id: file.id,
        title: file.name,
        subtitle: slash === -1 ? repositoryName : file.path.slice(0, slash + 1),
        name: file.name,
        stemLower: stemOf(file.name).toLowerCase(),
        path: file.path,
        nameOffset: file.path.length - file.name.length,
        prior: 5 - (file.isGenerated ? 20 : 0) - (file.category === "vendor" ? 10 : 0),
        language: file.language,
      }),
    );
  }

  for (const symbol of graph.symbols) {
    const file = index.filesById.get(symbol.fileId);
    if (!file) continue;
    const parent = symbol.parentSymbolId ? index.symbolsById.get(symbol.parentSymbolId) : undefined;
    const qualified = parent ? `${parent.name}.${symbol.name}` : "";
    const location = `${file.path}:${symbol.startLine}`;
    entries.push(
      createEntry({
        kind: "symbol",
        id: symbol.id,
        title: symbolTitle(symbol.name, symbol.kind),
        subtitle: parent ? `${parent.name} · ${location}` : location,
        name: symbol.name,
        stemLower: "",
        path: qualified,
        nameOffset: parent ? parent.name.length + 1 : 0,
        prior: SYMBOL_PRIORS[symbol.kind] + (symbol.exported ? 1 : 0) - (file.isGenerated ? 20 : 0),
        symbolKind: symbol.kind,
        language: file.language,
      }),
    );
  }

  return entries;
}

export function toResult(entry: SearchEntry, score: number, matches: number[]): SearchResult {
  return {
    ref: { kind: entry.kind, id: entry.id },
    kind: entry.kind,
    title: entry.title,
    subtitle: entry.subtitle,
    score,
    matches,
    ...(entry.symbolKind ? { symbolKind: entry.symbolKind } : {}),
    ...(entry.language ? { language: entry.language } : {}),
  };
}
