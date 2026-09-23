"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { GraphIndex } from "@/graph/model/graph-index";
import { nodeIdOf, TreeContext, TreeLevel } from "./summary-tree-items";
import {
  treeChildren,
  treeKeyAction,
  typeaheadTarget,
  TREE_PAGE_SIZE,
  type TreeRow,
} from "./summary-tree-model";

export interface SummaryTreeProps {
  index: GraphIndex;
  rows: readonly TreeRow[];
  expanded: ReadonlySet<string>;
  pages: ReadonlyMap<string, number>;
  focusedId: string | null;
  selectedId: string | null;
  label: string;
  onFocusChange: (id: string) => void;
  onToggle: (directoryId: string, expand: boolean) => void;
  onActivate: (id: string, kind: "directory" | "file") => void;
  onShowMore: (directoryId: string) => void;
  /** Scrolls this node into view whenever the request object changes. */
  revealRequest?: { id: string } | null;
}

/**
 * Accessible, lazily rendered repository tree (WAI-ARIA tree pattern with a
 * roving tabindex). Only expanded directories render their children, and large
 * directories are paged.
 */
export function SummaryTree({
  index,
  rows,
  expanded,
  pages,
  focusedId,
  selectedId,
  label,
  onFocusChange,
  onToggle,
  onActivate,
  onShowMore,
  revealRequest,
}: SummaryTreeProps) {
  const items = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef(false);
  const tabStopId = rows.some((row) => row.id === focusedId) ? focusedId : (rows[0]?.id ?? null);

  useEffect(() => {
    if (!pendingFocus.current || !tabStopId) return;
    pendingFocus.current = false;
    items.current.get(tabStopId)?.focus();
  }, [tabStopId, rows]);

  useEffect(() => {
    if (!revealRequest) return;
    items.current.get(revealRequest.id)?.scrollIntoView?.({ block: "nearest" });
  }, [revealRequest]);

  const moveFocus = (id: string) => {
    pendingFocus.current = true;
    onFocusChange(id);
  };

  const onRowClick = (id: string, kind: "directory" | "file" | "more", directoryId?: string) => {
    moveFocus(id);
    if (kind === "more" && directoryId) onShowMore(directoryId);
    else if (kind === "directory") {
      onToggle(id, !expanded.has(id));
      onActivate(id, kind);
    } else if (kind === "file") onActivate(id, kind);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Act on the item that actually has focus (it may have been focused by pointer or script).
    const currentId = nodeIdOf(event.target) ?? tabStopId;
    if (event.key.length === 1 && event.key !== " ") {
      const target = typeaheadTarget(rows, currentId, event.key);
      if (target) {
        event.preventDefault();
        moveFocus(target);
      }
      return;
    }
    const action = treeKeyAction(rows, currentId, event.key, expanded);
    if (!action) return;
    event.preventDefault();
    switch (action.type) {
      case "focus":
        moveFocus(action.id);
        break;
      case "expand":
        onToggle(action.id, true);
        break;
      case "collapse":
        onToggle(action.id, false);
        break;
      case "activate":
        if (action.kind === "directory") onToggle(action.id, !expanded.has(action.id));
        onActivate(action.id, action.kind);
        break;
      case "more": {
        // Focus the first newly revealed child.
        const shown = pages.get(action.directoryId) ?? TREE_PAGE_SIZE;
        const next = treeChildren(index, action.directoryId)[shown];
        onShowMore(action.directoryId);
        if (next) moveFocus(next.id);
        break;
      }
    }
  };

  return (
    <TreeContext.Provider
      value={{ index, expanded, pages, tabStopId, selectedId, items, onRowClick }}
    >
      <ul
        role="tree"
        aria-label={label}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const id = nodeIdOf(event.target);
          if (id && id !== focusedId) onFocusChange(id);
        }}
        className="space-y-px"
      >
        <TreeLevel directoryId={index.graph.rootDirectoryId} level={1} />
      </ul>
    </TreeContext.Provider>
  );
}
