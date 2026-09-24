"use client";

import { ChevronRight, CornerLeftUp, LogOut } from "lucide-react";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { Kbd } from "@/components/ui/primitives";
import { ROOT_DIRECTORY_ID } from "@/graph/model/ids";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";

/**
 * Shown while the user is "inside" a directory: the path from the repository
 * root (each segment re-focuses that level), "Up" (Backspace) and "Exit" (Esc).
 */
export function FocusBreadcrumb({ className }: { className?: string }) {
  const focusedDirectoryId = useExplorerStore((state) => state.focusedDirectoryId);
  const index = useExplorerStore((state) => state.index);
  const focusDirectory = useExplorerStore((state) => state.focusDirectory);
  if (!focusedDirectoryId || !index) return null;
  const chain = index
    .ancestorsOf(focusedDirectoryId)
    .map((id) => index.directoriesById.get(id))
    .filter((directory) => directory !== undefined);
  const current = chain[chain.length - 1];
  if (!current) return null;
  const parent = chain[chain.length - 2];

  return (
    <nav
      aria-label="Focused directory"
      className={cn(
        "glass animate-fade-in pointer-events-auto flex h-8 max-w-full min-w-0 items-center gap-1 rounded-lg pr-1 pl-2.5 text-xs",
        className,
      )}
    >
      <span className="text-ink-subtle shrink-0 max-sm:hidden">Inside</span>
      <ol className="flex min-w-0 items-center gap-1 font-mono">
        {chain.map((directory, position) => {
          const isCurrent = position === chain.length - 1;
          // Directory names come from the repository: hidden characters show as markers.
          const label = revealHiddenCharacters(
            directory.id === ROOT_DIRECTORY_ID ? index.graph.repository.name : directory.name,
          );
          return (
            <li
              key={directory.id}
              className={cn(
                "flex min-w-0 items-center gap-1",
                !isCurrent && position > 0 && "max-sm:hidden",
              )}
            >
              {position > 0 ? (
                <ChevronRight aria-hidden="true" className="text-ink-subtle size-3 shrink-0" />
              ) : null}
              {isCurrent ? (
                <span aria-current="location" className="text-flare truncate">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    focusDirectory(directory.id === ROOT_DIRECTORY_ID ? null : directory.id)
                  }
                  className="text-ink-muted hover:text-ink truncate rounded transition-colors"
                >
                  {label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <span aria-hidden="true" className="bg-line-strong mx-1 h-4 w-px shrink-0" />
      <button
        type="button"
        onClick={() => focusDirectory(parent && parent.id !== ROOT_DIRECTORY_ID ? parent.id : null)}
        className="text-ink-muted hover:bg-panel-raised hover:text-ink inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors"
        aria-label="Up one directory (Backspace)"
      >
        <CornerLeftUp aria-hidden="true" className="size-3.5" />
        <Kbd className="max-md:hidden">⌫</Kbd>
      </button>
      <button
        type="button"
        onClick={() => focusDirectory(null)}
        className="text-ink-muted hover:bg-panel-raised hover:text-ink inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors"
      >
        <LogOut aria-hidden="true" className="size-3.5" />
        <span>Exit directory</span>
      </button>
    </nav>
  );
}
