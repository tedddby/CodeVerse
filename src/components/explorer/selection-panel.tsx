"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Panel } from "@/components/ui/panel";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { directoryDisplayName, SYMBOL_KIND_LABELS } from "./node-descriptions";
import { DirectoryDetails } from "./selection-directory-details";
import { FileDetails } from "./selection-file-details";
import { SymbolDetails } from "./selection-symbol-details";
import { CANVAS_ATTRIBUTE } from "./use-explorer-shortcuts";

/** Right-docked panel on desktop, bottom sheet on narrow screens. */
const PANEL_POSITION =
  "pointer-events-auto fixed z-20 flex flex-col max-md:inset-x-2 max-md:bottom-2 max-md:max-h-[55dvh] max-md:animate-slide-up md:right-4 md:top-[7.75rem] md:max-h-[calc(100dvh-13.5rem)] md:w-[23rem] md:animate-slide-in-right xl:top-[4.75rem] xl:max-h-[calc(100dvh-10.5rem)]";

interface PanelContent {
  eyebrow: string;
  title: ReactNode;
  body: ReactNode;
}

function contentFor(selection: NodeRef, index: GraphIndex): PanelContent | null {
  switch (selection.kind) {
    case "file": {
      const file = index.filesById.get(selection.id);
      if (!file) return null;
      return { eyebrow: "File", title: <span title={file.path}>{file.name}</span>, body: <FileDetails file={file} index={index} /> };
    }
    case "directory": {
      const directory = index.directoriesById.get(selection.id);
      if (!directory) return null;
      return {
        eyebrow: directory.path === "" ? "Repository root" : "Directory",
        title: <span title={directory.path || "/"}>{directoryDisplayName(directory, index)}</span>,
        body: <DirectoryDetails directory={directory} index={index} />,
      };
    }
    case "symbol": {
      const symbol = index.symbolsById.get(selection.id);
      if (!symbol) return null;
      return {
        eyebrow: SYMBOL_KIND_LABELS[symbol.kind].singular,
        title: <span className="font-mono">{symbol.name}</span>,
        body: <SymbolDetails symbol={symbol} index={index} />,
      };
    }
  }
}

/**
 * Details of the current selection (file, directory or symbol). Renders
 * nothing without a selection; closing clears the selection. The positioned
 * wrapper stays mounted across selections (no replayed entrance animation)
 * while the panel itself remounts so scroll position and list expansion reset.
 *
 * Keyboard focus survives both: when the panel is replaced while it holds
 * focus (a path, import or symbol link inside it), focus moves to the new
 * panel's title; when it closes, focus returns to the 3D map.
 */
export function SelectionPanel({ className }: { className?: string }) {
  const selection = useExplorerStore((state) => state.selection);
  const index = useExplorerStore((state) => state.index);
  const select = useExplorerStore((state) => state.select);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusLost = useRef(false);
  const onUnmountWithFocus = useCallback(() => {
    focusLost.current = true;
  }, []);
  const content = selection && index ? contentFor(selection, index) : null;
  const panelKey = content && selection ? selection.id : null;

  // Runs after the replacement panel (if any) is in the DOM.
  useLayoutEffect(() => {
    if (!focusLost.current) return;
    focusLost.current = false;
    const target = titleRef.current ?? document.querySelector<HTMLElement>(`[${CANVAS_ATTRIBUTE}]`);
    target?.focus({ preventScroll: true });
  }, [panelKey]);

  if (!selection || !content) return null;

  return (
    <div className={cn(PANEL_POSITION, className)}>
      <Panel
        key={selection.id}
        eyebrow={content.eyebrow}
        title={content.title}
        titleRef={titleRef}
        onUnmountWithFocus={onUnmountWithFocus}
        onClose={() => select(null)}
        aria-label="Selection details"
        className="min-h-0"
      >
        {content.body}
      </Panel>
    </div>
  );
}
