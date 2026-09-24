"use client";

import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { createContext, useContext, type MutableRefObject } from "react";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger, pluralize } from "@/lib/utils/format";
import { moreRowId, TREE_PAGE_SIZE, treeChildren, type TreeChild } from "./summary-tree-model";

/**
 * Rendering of the repository tree's items (directories, files, "show more"
 * rows), recursively and only for expanded directories. Behaviour (keyboard,
 * focus) lives in `SummaryTree`, which provides the context.
 */

export interface TreeContextValue {
  index: GraphIndex;
  expanded: ReadonlySet<string>;
  pages: ReadonlyMap<string, number>;
  tabStopId: string | null;
  selectedId: string | null;
  items: MutableRefObject<Map<string, HTMLElement>>;
  onRowClick: (id: string, kind: "directory" | "file" | "more", directoryId?: string) => void;
}

export const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const value = useContext(TreeContext);
  if (!value) throw new Error("Tree items must be rendered inside SummaryTree");
  return value;
}

function registerItem(items: MutableRefObject<Map<string, HTMLElement>>, id: string) {
  return (element: HTMLElement | null) => {
    if (element) items.current.set(id, element);
    else items.current.delete(id);
  };
}

const ITEM_CLASS =
  "outline-none [&:focus-visible>div]:outline [&:focus-visible>div]:outline-2 [&:focus-visible>div]:-outline-offset-2 [&:focus-visible>div]:outline-signal";

function rowClass(selected: boolean): string {
  return cn(
    "flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm",
    selected ? "bg-flare/10 text-ink" : "text-ink-muted hover:bg-panel-raised hover:text-ink",
  );
}

/** Node id of the tree item containing `target` (items carry `data-node-id`). */
export function nodeIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>("[role='treeitem']");
  return item?.dataset.nodeId ?? null;
}

function indent(level: number): { paddingLeft: string } {
  return { paddingLeft: `${0.25 + (level - 1) * 1.1}rem` };
}

export function TreeLevel({ directoryId, level }: { directoryId: string; level: number }) {
  const { index, pages } = useTree();
  const children = treeChildren(index, directoryId);
  const limit = Math.min(children.length, pages.get(directoryId) ?? TREE_PAGE_SIZE);
  return (
    <>
      {children
        .slice(0, limit)
        .map((child, i) =>
          child.kind === "directory" ? (
            <DirectoryItem
              key={child.id}
              child={child}
              level={level}
              posinset={i + 1}
              setsize={children.length}
            />
          ) : (
            <FileItem
              key={child.id}
              child={child}
              level={level}
              posinset={i + 1}
              setsize={children.length}
            />
          ),
        )}
      {limit < children.length ? (
        <MoreItem directoryId={directoryId} level={level} remaining={children.length - limit} />
      ) : null}
    </>
  );
}

interface ItemProps {
  child: TreeChild;
  level: number;
  posinset: number;
  setsize: number;
}

function DirectoryItem({ child, level, posinset, setsize }: ItemProps) {
  const { index, expanded, tabStopId, selectedId, items, onRowClick } = useTree();
  const directory = index.directoriesById.get(child.id);
  const isExpanded = expanded.has(child.id);
  const selected = selectedId === child.id;
  const Icon = isExpanded ? FolderOpen : Folder;
  return (
    <li
      ref={registerItem(items, child.id)}
      data-node-id={child.id}
      role="treeitem"
      aria-expanded={isExpanded}
      aria-selected={selected}
      aria-level={level}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-label={`${escapeHiddenCharacters(child.name)}, ${pluralize(directory?.stats.fileCount ?? 0, "file")}`}
      tabIndex={tabStopId === child.id ? 0 : -1}
      className={ITEM_CLASS}
    >
      <div
        className={rowClass(selected)}
        style={indent(level)}
        onClick={() => onRowClick(child.id, "directory")}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "text-ink-subtle size-3.5 shrink-0 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        <Icon aria-hidden="true" className="text-ink-subtle size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {revealHiddenCharacters(child.name)}
        </span>
        {directory ? (
          <span aria-hidden="true" className="text-ink-subtle shrink-0 font-mono text-[11px]">
            {pluralize(directory.stats.fileCount, "file")} ·{" "}
            {directory.stats.linesEstimated ? "~" : ""}
            {formatCompact(directory.stats.totalLines)} LOC
          </span>
        ) : null}
      </div>
      {isExpanded ? (
        <ul role="group" className="space-y-px">
          <TreeLevel directoryId={child.id} level={level + 1} />
        </ul>
      ) : null}
    </li>
  );
}

const STATUS_LABELS: Record<string, string> = {
  partial: "partial",
  "content-only": "not parsed",
  "metadata-only": "metadata only",
  binary: "binary",
  failed: "failed",
};

function FileItem({ child, level, posinset, setsize }: ItemProps) {
  const { index, tabStopId, selectedId, items, onRowClick } = useTree();
  const file = index.filesById.get(child.id);
  const selected = selectedId === child.id;
  const status = file ? STATUS_LABELS[file.status] : undefined;
  return (
    <li
      ref={registerItem(items, child.id)}
      data-node-id={child.id}
      role="treeitem"
      aria-selected={selected}
      aria-level={level}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-label={escapeHiddenCharacters(child.name)}
      tabIndex={tabStopId === child.id ? 0 : -1}
      className={ITEM_CLASS}
    >
      <div
        className={rowClass(selected)}
        style={indent(level)}
        onClick={() => onRowClick(child.id, "file")}
      >
        <span aria-hidden="true" className="w-3.5 shrink-0" />
        {file ? <LanguageDot language={file.language} className="mx-1" /> : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {revealHiddenCharacters(child.name)}
        </span>
        {status ? (
          <Badge tone={file?.status === "failed" ? "danger" : "neutral"} className="shrink-0">
            {status}
          </Badge>
        ) : null}
        {file && file.status !== "binary" ? (
          <span aria-hidden="true" className="text-ink-subtle shrink-0 font-mono text-[11px]">
            {file.linesEstimated ? "~" : ""}
            {pluralize(file.lines, "line")}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function MoreItem({
  directoryId,
  level,
  remaining,
}: {
  directoryId: string;
  level: number;
  remaining: number;
}) {
  const { tabStopId, items, onRowClick } = useTree();
  const id = moreRowId(directoryId);
  const batch = Math.min(TREE_PAGE_SIZE, remaining);
  return (
    <li
      ref={registerItem(items, id)}
      data-node-id={id}
      role="treeitem"
      aria-selected={false}
      aria-level={level}
      aria-label={`Show ${formatInteger(batch)} more (${formatInteger(remaining)} not shown)`}
      tabIndex={tabStopId === id ? 0 : -1}
      className={ITEM_CLASS}
    >
      <div
        className="text-signal hover:bg-signal/10 flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-xs"
        style={indent(level)}
        onClick={() => onRowClick(id, "more", directoryId)}
      >
        <span aria-hidden="true" className="w-3.5 shrink-0" />
        Show {formatInteger(batch)} more · {formatInteger(remaining)} not shown
      </div>
    </li>
  );
}
