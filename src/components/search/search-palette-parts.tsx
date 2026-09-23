import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { formatInteger } from "@/lib/utils/format";
import { SEARCH_FILTERS, type SearchFilterId } from "./search-palette-model";

/**
 * Filter chips of the search palette. They are not tab stops: Tab / Shift+Tab
 * in the query field cycles them, and clicking does not steal the input's focus.
 */
export function SearchFilterBar({
  filter,
  onChange,
}: {
  filter: SearchFilterId;
  onChange: (filter: SearchFilterId) => void;
}) {
  return (
    <div
      className="border-line/60 flex items-center gap-1 border-b px-3 py-2"
      aria-label="Result filters"
      role="group"
    >
      {SEARCH_FILTERS.map((item) => (
        <button
          key={item.id}
          type="button"
          tabIndex={-1}
          aria-pressed={filter === item.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition-colors",
            filter === item.id
              ? "bg-signal/12 text-signal shadow-[inset_0_0_0_1px_rgba(77,226,255,0.35)]"
              : "text-ink-subtle hover:bg-panel-raised hover:text-ink",
          )}
        >
          {item.label}
        </button>
      ))}
      <span className="text-ink-subtle ml-auto hidden items-center gap-1.5 text-[11px] sm:flex">
        <Kbd>Tab</Kbd> to switch
      </span>
    </div>
  );
}

/** Keyboard hints and index size, referenced by the query field's aria-describedby. */
export function SearchPaletteFooter({
  id,
  files,
  symbols,
}: {
  id: string;
  files: number;
  symbols: number;
}) {
  return (
    <div
      id={id}
      className="border-line/60 text-ink-subtle flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[11px]"
    >
      <span className="flex items-center gap-1.5">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> navigate
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd> fly to
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">
        <Kbd>Ctrl</Kbd>
        <Kbd>↵</Kbd> view source
      </span>
      <span className="ml-auto hidden font-mono sm:inline">
        {formatInteger(files)} files · {formatInteger(symbols)} symbols
      </span>
    </div>
  );
}
