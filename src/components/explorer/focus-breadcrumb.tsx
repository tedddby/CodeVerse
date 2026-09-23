"use client";

import { ChevronRight, CornerLeftUp, LogOut } from "lucide-react";
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
      className={cn("glass pointer-events-auto flex h-8 min-w-0 max-w-full items-center gap-1 rounded-lg pl-2.5 pr-1 text-xs animate-fade-in", className)}
    >
      <span className="shrink-0 text-ink-subtle max-sm:hidden">Inside</span>
      <ol className="flex min-w-0 items-center gap-1 font-mono">
        {chain.map((directory, position) => {
          const isCurrent = position === chain.length - 1;
          const label = directory.id === ROOT_DIRECTORY_ID ? index.graph.repository.name : directory.name;
          return (
            <li key={directory.id} className={cn("flex min-w-0 items-center gap-1", !isCurrent && position > 0 && "max-sm:hidden")}>
              {position > 0 ? <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-ink-subtle" /> : null}
              {isCurrent ? (
                <span aria-current="location" className="truncate text-flare">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => focusDirectory(directory.id === ROOT_DIRECTORY_ID ? null : directory.id)}
                  className="truncate rounded text-ink-muted transition-colors hover:text-ink"
                >
                  {label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
      <button
        type="button"
        onClick={() => focusDirectory(parent && parent.id !== ROOT_DIRECTORY_ID ? parent.id : null)}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-panel-raised hover:text-ink"
        aria-label="Up one directory (Backspace)"
      >
        <CornerLeftUp aria-hidden="true" className="size-3.5" />
        <Kbd className="max-md:hidden">⌫</Kbd>
      </button>
      <button
        type="button"
        onClick={() => focusDirectory(null)}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-panel-raised hover:text-ink"
      >
        <LogOut aria-hidden="true" className="size-3.5" />
        <span>Exit directory</span>
      </button>
    </nav>
  );
}
