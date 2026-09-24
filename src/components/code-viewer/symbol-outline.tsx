import { NodeIcon, SYMBOL_KIND_LABELS } from "@/components/search/node-icon";
import type { SymbolNode } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { escapeHiddenCharacters } from "./hidden-characters";
import { revealHiddenCharacters } from "./revealed-text";

export interface OutlineEntry {
  symbol: SymbolNode;
  depth: number;
}

/** Orders a file's symbols by position and computes nesting depth from parent links. */
export function buildOutline(symbols: readonly SymbolNode[]): OutlineEntry[] {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol] as const));
  const depthOf = (symbol: SymbolNode): number => {
    let depth = 0;
    let parentId = symbol.parentSymbolId;
    const seen = new Set<string>();
    while (parentId && byId.has(parentId) && !seen.has(parentId) && depth < 8) {
      seen.add(parentId);
      depth += 1;
      parentId = byId.get(parentId)?.parentSymbolId;
    }
    return depth;
  };
  return [...symbols]
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine)
    .map((symbol) => ({ symbol, depth: depthOf(symbol) }));
}

/** Innermost symbol whose range contains `line`, or null. */
export function symbolAtLine(
  outline: readonly OutlineEntry[],
  line: number | undefined,
): SymbolNode | null {
  if (line === undefined) return null;
  let best: OutlineEntry | null = null;
  for (const entry of outline) {
    if (entry.symbol.startLine <= line && line <= entry.symbol.endLine) {
      if (!best || entry.depth >= best.depth) best = entry;
    }
  }
  return best?.symbol ?? null;
}

export interface SymbolOutlineProps {
  outline: readonly OutlineEntry[];
  activeSymbolId: string | null;
  onSelect: (symbol: SymbolNode) => void;
}

export function SymbolOutline({ outline, activeSymbolId, onSelect }: SymbolOutlineProps) {
  return (
    <nav aria-label="Symbols in this file" className="flex min-h-0 flex-col">
      <p className="text-ink-subtle px-3 pt-3 pb-2 font-mono text-[10.5px] tracking-[0.18em] uppercase">
        Outline · {outline.length}
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-3">
        {outline.map(({ symbol, depth }) => {
          const active = symbol.id === activeSymbolId;
          return (
            <li key={symbol.id}>
              <button
                type="button"
                onClick={() => onSelect(symbol)}
                aria-current={active ? "location" : undefined}
                title={escapeHiddenCharacters(symbol.signature ?? symbol.name)}
                className={cn(
                  "flex w-full items-center gap-2 py-1 pr-3 text-left text-xs transition-colors",
                  active
                    ? "bg-flare/10 text-ink"
                    : "text-ink-muted hover:bg-panel-raised hover:text-ink",
                )}
                style={{ paddingLeft: `${0.75 + depth * 0.85}rem` }}
              >
                <NodeIcon kind="symbol" symbolKind={symbol.kind} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate font-mono">
                  {revealHiddenCharacters(symbol.name)}
                </span>
                <span className="sr-only">{SYMBOL_KIND_LABELS[symbol.kind]},</span>
                <span className="text-ink-subtle shrink-0 font-mono text-[10.5px] tabular-nums">
                  <span className="sr-only">line </span>
                  {symbol.startLine}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
