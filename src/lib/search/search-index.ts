import type { GraphIndex } from "@/graph/model/graph-index";
import {
  buildSearchEntries,
  toResult,
  type SearchEntry,
  type SearchResult,
  type SearchResultKind,
} from "./search-entries";
import { buildSuggestions, fileSuggestionBasis } from "./suggestions";
import {
  characterMask,
  fuzzyMatch,
  fuzzyScore,
  isSubsequence,
  maxFuzzyScore,
  NO_MATCH,
  prepareQuery,
  type PreparedQuery,
} from "./fuzzy";

/**
 * Repository-wide quick-open search over directories, files and symbols.
 *
 * `buildSearchIndex` precomputes lower-case keys and display strings once per
 * graph (O(n)); `searchRepository` then scores every entry with the allocation-free
 * fuzzy scorer, keeps a bounded top-K and only computes highlight positions for
 * the results that are returned. Ranking tiers, strongest first:
 *
 *   exact name  >  exact file stem  >  name prefix  >  fuzzy name  >  path-only match
 *
 * Within a tier the fuzzy score (word boundaries, consecutive runs, compactness)
 * decides, then small priors (kind, exported, generated), then shorter paths.
 */

export { symbolTitle } from "./search-entries";
export type { SearchEntry, SearchResult, SearchResultKind } from "./search-entries";

export interface SearchOptions {
  /** Maximum number of results (default 50). */
  limit?: number;
  /** Restrict results to these kinds (default: all). */
  kinds?: ReadonlyArray<SearchResultKind>;
}

export interface SearchIndex {
  readonly entries: ReadonlyArray<SearchEntry>;
  /** Shown for an empty query: most-connected (or largest) files and largest directories. */
  readonly suggestions: ReadonlyArray<SearchResult>;
  /**
   * Why files were suggested: by internal dependency count, or by size when the
   * repository has no resolved internal imports.
   */
  readonly fileSuggestionBasis: "connections" | "size";
  readonly counts: Readonly<Record<SearchResultKind, number>>;
}

export const DEFAULT_SEARCH_LIMIT = 50;

const TIER_EXACT = 40_000;
const TIER_STEM = 35_000;
const TIER_PREFIX = 30_000;
const TIER_NAME = 20_000;
const TIER_PATH = 0;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildSearchIndex(index: GraphIndex): SearchIndex {
  const entries = buildSearchEntries(index);
  const counts: Record<SearchResultKind, number> = { directory: 0, file: 0, symbol: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return {
    entries,
    suggestions: buildSuggestions(index, entries),
    fileSuggestionBasis: fileSuggestionBasis(index),
    counts,
  };
}

interface ScoredEntry {
  entry: SearchEntry;
  score: number;
  /** Which key produced the score (needed to recompute highlight positions). */
  via: "name" | "path";
}

function compareScored(a: ScoredEntry, b: ScoredEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  return compareText(a.entry.title, b.entry.title) || compareText(a.entry.id, b.entry.id);
}

function nameTier(entry: SearchEntry, queryLower: string): number {
  if (entry.nameLower === queryLower) return TIER_EXACT;
  if (entry.stemLower === queryLower) return TIER_STEM;
  if (entry.nameLower.startsWith(queryLower)) return TIER_PREFIX;
  return TIER_NAME;
}

/** Exact path / path-suffix matches ("auth/jwt.ts") are as good as a name prefix. */
function pathTier(entry: SearchEntry, queryLower: string): number {
  const path = entry.pathLower;
  if (!path.endsWith(queryLower)) return TIER_PATH;
  const boundary = path.length - queryLower.length;
  return boundary === 0 || queryLower.startsWith("/") || path.charAt(boundary - 1) === "/"
    ? TIER_PREFIX
    : TIER_PATH;
}

/**
 * Scores one entry; returns null when it does not match or provably cannot
 * beat `floor` (the lowest score in a full top-K). `maxDp` is the upper bound
 * of the fuzzy score for the current query and `queryMask` its character mask.
 */
function scoreEntry(
  entry: SearchEntry,
  query: PreparedQuery,
  queryMask: number,
  pathQuery: boolean,
  floor: number,
  maxDp: number,
): ScoredEntry | null {
  const q = query.lower;
  const bias = entry.bias;
  const pathPossible = entry.pathLower !== "" && (entry.pathMask & queryMask) === queryMask;

  if (!pathQuery && (entry.nameMask & queryMask) === queryMask) {
    const tier = nameTier(entry, q);
    if (tier + maxDp + bias >= floor) {
      const dp = fuzzyScore(query, entry.name, entry.nameLower);
      if (dp !== NO_MATCH) return { entry, score: tier + dp + bias, via: "name" };
    } else {
      // The name cannot enter the top-K. The path is only consulted when the
      // name does not match at all, so bail out unless the path could win.
      if (!pathPossible || pathTier(entry, q) + maxDp + bias < floor) return null;
      if (isSubsequence(q, entry.nameLower)) return null;
    }
  }

  if (!pathPossible) return null;
  const tier = pathTier(entry, q);
  if (tier + maxDp + bias < floor) return null;
  const dp = fuzzyScore(query, entry.path, entry.pathLower);
  return dp === NO_MATCH ? null : { entry, score: tier + dp + bias, via: "path" };
}

function titleMatches(scored: ScoredEntry, query: PreparedQuery): number[] {
  const { entry } = scored;
  if (scored.via === "name") return fuzzyMatch(query, entry.name, entry.nameLower)?.positions ?? [];
  const positions = fuzzyMatch(query, entry.path, entry.pathLower)?.positions ?? [];
  return positions.filter((p) => p >= entry.nameOffset).map((p) => p - entry.nameOffset);
}

/**
 * Searches the index. An empty (or whitespace-only) query returns suggestions.
 * Results are sorted by descending score; ties are broken by title, then id.
 */
export function searchRepository(
  searchIndex: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_SEARCH_LIMIT);
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const prepared = prepareQuery(query);

  if (prepared.lower.length === 0) {
    return searchIndex.suggestions
      .filter((result) => !kinds || kinds.has(result.kind))
      .slice(0, limit);
  }

  const pathQuery = prepared.lower.includes("/");
  const maxDp = maxFuzzyScore(prepared.lower.length);
  const queryMask = characterMask(prepared.lower);
  // Bounded top-K kept sorted by descending score; `floor` is the score to beat once full.
  const top: ScoredEntry[] = [];
  let floor = Number.NEGATIVE_INFINITY;

  for (const entry of searchIndex.entries) {
    if (kinds && !kinds.has(entry.kind)) continue;
    const scored = scoreEntry(entry, prepared, queryMask, pathQuery, floor, maxDp);
    if (!scored || scored.score < floor) continue;
    let insertAt = top.length;
    while (insertAt > 0) {
      const previous = top[insertAt - 1];
      if (!previous || compareScored(previous, scored) <= 0) break;
      insertAt -= 1;
    }
    if (insertAt >= limit) continue;
    top.splice(insertAt, 0, scored);
    if (top.length > limit) top.pop();
    floor = top.length >= limit ? (top[top.length - 1]?.score ?? floor) : Number.NEGATIVE_INFINITY;
  }

  return top.map((scored) => toResult(scored.entry, scored.score, titleMatches(scored, prepared)));
}

const indexCache = new WeakMap<GraphIndex, SearchIndex>();

/** Returns the search index for a graph index, building it once and caching it weakly. */
export function getSearchIndex(index: GraphIndex): SearchIndex {
  const cached = indexCache.get(index);
  if (cached) return cached;
  const built = buildSearchIndex(index);
  indexCache.set(index, built);
  return built;
}
