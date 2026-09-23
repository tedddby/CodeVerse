"use client";

import { Search } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import {
  DEFAULT_SEARCH_LIMIT,
  getSearchIndex,
  searchRepository,
  type SearchResult,
} from "@/lib/search/search-index";
import { cn } from "@/lib/utils/cn";
import { pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import {
  cycleFilter,
  filterKinds,
  groupResults,
  moveActive,
  SEARCH_FILTERS,
  type SearchFilterId,
} from "./search-palette-model";
import { SearchFilterBar, SearchPaletteFooter } from "./search-palette-parts";
import { SearchResultRow } from "./search-result-row";

/**
 * Quick-open command palette over directories, files and symbols.
 * Opens on `panels.search` (the explorer shell binds "/"). Choosing a result
 * selects it and flies the camera there; Ctrl/⌘+Enter also opens its source.
 */
export function SearchPalette() {
  const open = useExplorerStore((state) => state.panels.search);
  const index = useExplorerStore((state) => state.index);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const close = useCallback(() => setPanel("search", false), [setPanel]);

  // Build the index while the browser is idle after a graph loads, so the first
  // "/" opens instantly even for very large repositories.
  useEffect(() => {
    if (!index) return;
    const build = () => {
      getSearchIndex(index);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(build, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(build, 1_000);
    return () => clearTimeout(timer);
  }, [index]);

  if (!open || !index) return null;
  return <SearchPaletteDialog index={index} onClose={close} />;
}

const SUGGESTION_LABELS = {
  file: "Most-connected files",
  directory: "Largest directories",
  symbol: "Symbols",
};

function suggestionLabel(
  kind: keyof typeof SUGGESTION_LABELS,
  basis: "connections" | "size",
): string {
  return kind === "file" && basis === "size" ? "Largest files" : SUGGESTION_LABELS[kind];
}

function SearchPaletteDialog({ index, onClose }: { index: GraphIndex; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilterId>("all");
  const deferredQuery = useDeferredValue(query);
  const select = useExplorerStore((state) => state.select);
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);

  const searchIndex = useMemo(() => getSearchIndex(index), [index]);
  const results = useMemo(
    () =>
      searchRepository(searchIndex, deferredQuery, {
        limit: DEFAULT_SEARCH_LIMIT,
        kinds: filterKinds(filter),
      }),
    [searchIndex, deferredQuery, filter],
  );
  const { groups, ordered } = useMemo(() => groupResults(results), [results]);

  // The active option is tied to the result list it was chosen in, so a new
  // result list starts at the top without a state-syncing effect.
  const [active, setActive] = useState<{ source: SearchResult[]; index: number }>({
    source: [],
    index: 0,
  });
  const activeIndex =
    ordered.length === 0
      ? -1
      : active.source === ordered
        ? Math.min(active.index, ordered.length - 1)
        : 0;
  const optionId = (position: number) => `${listboxId}-option-${position}`;
  const isSuggestions = deferredQuery.trim() === "";
  const isStale = query !== deferredQuery;

  // Tab cycles the filters. Handled natively (and stopped) on the input so the
  // dialog's focus trap never moves focus away from the query field.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onTab = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Tab" ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setFilter((current) => cycleFilter(current, event.shiftKey ? -1 : 1));
    };
    input.addEventListener("keydown", onTab);
    return () => input.removeEventListener("keydown", onTab);
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, ordered]);

  const choose = useCallback(
    (result: SearchResult, viewSource: boolean) => {
      select(result.ref, { focus: true });
      if (viewSource && result.kind === "file") {
        openCodeViewer({ fileId: result.ref.id });
      } else if (viewSource && result.kind === "symbol") {
        const symbol = index.symbolsById.get(result.ref.id);
        if (symbol)
          openCodeViewer({
            fileId: symbol.fileId,
            line: symbol.startLine,
            endLine: symbol.endLine,
          });
      }
      onClose();
    },
    [index, onClose, openCodeViewer, select],
  );

  const hover = useCallback(
    (position: number) => setActive({ source: ordered, index: position }),
    [ordered],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive({ source: ordered, index: moveActive(activeIndex, delta, ordered.length) });
        break;
      }
      case "Enter": {
        event.preventDefault();
        const result = ordered[activeIndex];
        if (result) choose(result, event.metaKey || event.ctrlKey);
        break;
      }
      default:
        break;
    }
  };

  const activeFilterLabel = SEARCH_FILTERS.find((item) => item.id === filter)?.label ?? "All";
  const status = isSuggestions
    ? `${pluralize(ordered.length, "suggestion")}.`
    : ordered.length === 0
      ? `No results for ${deferredQuery.trim()}.`
      : `${pluralize(ordered.length, "result")}${ordered.length >= DEFAULT_SEARCH_LIMIT ? " (top matches)" : ""}.`;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Search repository"
      hideTitle
      placement="top"
      initialFocusRef={inputRef}
      className="max-w-2xl! overflow-hidden"
    >
      <div className="border-line/80 flex items-center gap-3 border-b px-4">
        <Search aria-hidden="true" className="text-ink-subtle size-4 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search repository"
          aria-expanded={ordered.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={`${listboxId}-hint`}
          placeholder="Search repository..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="text-ink placeholder:text-ink-subtle h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
      </div>

      <SearchFilterBar filter={filter} onChange={setFilter} />

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={`${activeFilterLabel} results`}
        className={cn(
          "max-h-[min(60vh,28rem)] overflow-y-auto py-2 transition-opacity",
          isStale && "opacity-70",
        )}
      >
        {groups.map((group) => (
          <div
            key={group.kind}
            role="group"
            aria-labelledby={`${listboxId}-${group.kind}`}
            className="pb-1"
          >
            <div
              id={`${listboxId}-${group.kind}`}
              role="presentation"
              className="text-ink-subtle px-5 pt-2 pb-1 font-mono text-[10.5px] tracking-[0.18em] uppercase"
            >
              {isSuggestions
                ? suggestionLabel(group.kind, searchIndex.fileSuggestionBasis)
                : group.label}
            </div>
            {group.items.map(({ result, index: position }) => (
              <SearchResultRow
                key={`${result.kind}:${result.ref.id}`}
                id={optionId(position)}
                result={result}
                index={position}
                active={position === activeIndex}
                onHover={hover}
                onChoose={choose}
              />
            ))}
          </div>
        ))}
        {ordered.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-ink text-sm">
              {isSuggestions ? (
                "Nothing to suggest yet."
              ) : (
                <>No matches for “{deferredQuery.trim()}”.</>
              )}
            </p>
            <p className="text-ink-subtle mt-1 text-xs">
              Try a file name, a path like <span className="font-mono">src/auth</span> or a symbol
              like <span className="font-mono">parseConfig</span>.
            </p>
          </div>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <SearchPaletteFooter
        id={`${listboxId}-hint`}
        files={searchIndex.counts.file}
        symbols={searchIndex.counts.symbol}
      />
    </Dialog>
  );
}
