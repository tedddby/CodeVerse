import type { SearchResult, SearchResultKind } from "@/lib/search/search-index";

/** Filter tabs of the search palette, cycled with Tab / Shift+Tab. */
export type SearchFilterId = "all" | "file" | "directory" | "symbol";

export interface SearchFilter {
  id: SearchFilterId;
  label: string;
  kinds?: SearchResultKind[];
}

export const SEARCH_FILTERS: readonly SearchFilter[] = [
  { id: "all", label: "All" },
  { id: "file", label: "Files", kinds: ["file"] },
  { id: "directory", label: "Directories", kinds: ["directory"] },
  { id: "symbol", label: "Symbols", kinds: ["symbol"] },
];

export function cycleFilter(current: SearchFilterId, direction: 1 | -1): SearchFilterId {
  const index = SEARCH_FILTERS.findIndex((filter) => filter.id === current);
  const next = (index + direction + SEARCH_FILTERS.length) % SEARCH_FILTERS.length;
  return SEARCH_FILTERS[next]?.id ?? "all";
}

export function filterKinds(id: SearchFilterId): SearchResultKind[] | undefined {
  return SEARCH_FILTERS.find((filter) => filter.id === id)?.kinds;
}

const GROUP_LABELS: Record<SearchResultKind, string> = {
  file: "Files",
  directory: "Directories",
  symbol: "Symbols",
};

export interface ResultGroup {
  kind: SearchResultKind;
  label: string;
  items: Array<{ result: SearchResult; index: number }>;
}

/**
 * Groups results by kind. Groups are ordered by their best (first) result so
 * the top hit always comes first; `index` is the position in display order,
 * which is what keyboard navigation walks through.
 */
export function groupResults(results: readonly SearchResult[]): {
  groups: ResultGroup[];
  ordered: SearchResult[];
} {
  const byKind = new Map<SearchResultKind, SearchResult[]>();
  for (const result of results) {
    const list = byKind.get(result.kind);
    if (list) list.push(result);
    else byKind.set(result.kind, [result]);
  }
  const groups: ResultGroup[] = [];
  const ordered: SearchResult[] = [];
  for (const [kind, list] of byKind) {
    groups.push({
      kind,
      label: GROUP_LABELS[kind],
      items: list.map((result) => {
        ordered.push(result);
        return { result, index: ordered.length - 1 };
      }),
    });
  }
  return { groups, ordered };
}

/** Moves the active index by `delta`, wrapping around; -1 when there are no results. */
export function moveActive(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}
