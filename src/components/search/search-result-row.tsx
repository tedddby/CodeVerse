import { CornerDownLeft } from "lucide-react";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { LanguageDot } from "@/components/ui/primitives";
import type { SearchResult } from "@/lib/search/search-index";
import { cn } from "@/lib/utils/cn";
import { HighlightedText } from "./highlighted-text";
import { NodeIcon, SYMBOL_KIND_LABELS } from "./node-icon";

export interface SearchResultRowProps {
  id: string;
  result: SearchResult;
  index: number;
  active: boolean;
  onHover: (index: number) => void;
  onChoose: (result: SearchResult, viewSource: boolean) => void;
}

/** One option of the search listbox. Focus stays in the input (aria-activedescendant). */
export function SearchResultRow({
  id,
  result,
  index,
  active,
  onHover,
  onChoose,
}: SearchResultRowProps) {
  const kindLabel =
    result.kind === "symbol" && result.symbolKind
      ? SYMBOL_KIND_LABELS[result.symbolKind]
      : result.kind === "directory"
        ? "Directory"
        : "File";
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-result-index={index}
      onMouseMove={() => {
        if (!active) onHover(index);
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onChoose(result, event.metaKey || event.ctrlKey)}
      className={cn(
        "group/row mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm",
        active
          ? "bg-signal/10 text-ink shadow-[inset_2px_0_0_var(--color-signal)]"
          : "text-ink-muted",
      )}
    >
      <NodeIcon kind={result.kind} symbolKind={result.symbolKind} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <HighlightedText
          text={result.title}
          matches={result.matches}
          className={cn(
            "max-w-[65%] shrink-0 truncate font-mono text-[13px]",
            active ? "text-ink" : "text-ink/90",
          )}
        />
        {result.kind === "file" && result.language ? (
          <LanguageDot language={result.language} className="self-center" />
        ) : null}
        <span className="text-ink-subtle min-w-0 truncate text-xs">
          {revealHiddenCharacters(result.subtitle)}
        </span>
      </div>
      <span className="sr-only">, {kindLabel}</span>
      <span
        aria-hidden="true"
        className="text-ink-subtle shrink-0 font-mono text-[10.5px] tracking-wider uppercase"
      >
        {active ? <CornerDownLeft className="text-signal size-3.5" /> : kindLabel}
      </span>
    </div>
  );
}
