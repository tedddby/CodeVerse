"use client";

import { Folder, MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";
import { LanguageDot } from "@/components/ui/primitives";
import { getLanguage } from "@/lib/languages/registry";
import { formatInteger, pluralize } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import {
  selectSelectedDirectory,
  selectSelectedFile,
  selectSelectedSymbol,
  useExplorerStore,
} from "@/state/explorer-store";

/**
 * Compact description of the current selection in the demo world. It is a
 * polite live region so keyboard and screen-reader users hear what was picked.
 */
export function DemoReadout({ className }: { className?: string }) {
  const file = useExplorerStore(selectSelectedFile);
  const directory = useExplorerStore(selectSelectedDirectory);
  const symbol = useExplorerStore(selectSelectedSymbol);
  const symbolFile = useExplorerStore((state) =>
    symbol ? (state.index?.filesById.get(symbol.fileId) ?? null) : null,
  );

  let content: ReactNode;
  if (file) {
    content = (
      <>
        <LanguageDot language={file.language} />
        <span className="text-ink min-w-0 truncate font-mono">{file.path}</span>
        <span className="text-ink-muted hidden shrink-0 sm:inline">
          {getLanguage(file.language).name} · {formatInteger(file.lines)} lines ·{" "}
          {pluralize(file.symbolIds.length, "symbol")}
        </span>
      </>
    );
  } else if (directory) {
    content = (
      <>
        <Folder aria-hidden="true" className="text-signal size-3.5 shrink-0" />
        <span className="text-ink min-w-0 truncate font-mono">{directory.path || "/"}</span>
        <span className="text-ink-muted hidden shrink-0 sm:inline">
          {pluralize(directory.stats.fileCount, "file")}
        </span>
      </>
    );
  } else if (symbol) {
    content = (
      <>
        <span className="text-ion shrink-0 font-mono text-[10.5px] tracking-wider uppercase">
          {symbol.kind}
        </span>
        <span className="text-ink min-w-0 truncate font-mono">{symbol.name}</span>
        {symbolFile ? (
          <span className="text-ink-muted hidden min-w-0 truncate sm:inline">
            {symbolFile.path}
          </span>
        ) : null}
      </>
    );
  } else {
    content = (
      <>
        <MousePointerClick aria-hidden="true" className="text-ink-muted size-3.5 shrink-0" />
        <span className="text-ink-muted">Select a building to inspect its file</span>
      </>
    );
  }

  return (
    <div
      aria-live="polite"
      className={cn(
        "glass flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs shadow-lg",
        className,
      )}
    >
      {content}
    </div>
  );
}
