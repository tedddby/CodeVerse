import type { GraphIndex } from "@/graph/model/graph-index";

/**
 * Pure model of the accessible repository tree: ordering, lazy flattening of
 * the visible rows (only expanded directories contribute children, and large
 * directories are paged) and WAI-ARIA tree keyboard behaviour.
 */

/** Children rendered per directory before a "show more" row. */
export const TREE_PAGE_SIZE = 200;

export interface TreeChild {
  kind: "directory" | "file";
  id: string;
  name: string;
}

export interface TreeRow {
  kind: "directory" | "file" | "more";
  /** Node id; for "more" rows: `more:<directory id>`. */
  id: string;
  name: string;
  /** Parent directory id (null for top-level rows). */
  parentId: string | null;
  /** 1-based nesting level (aria-level). */
  level: number;
  /** 1-based position among siblings and sibling count (aria-posinset / aria-setsize). */
  posinset: number;
  setsize: number;
  /** For "more" rows: how many children are still hidden. */
  remaining?: number;
}

const childrenCache = new WeakMap<GraphIndex, Map<string, TreeChild[]>>();

function byName(a: TreeChild, b: TreeChild): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Directories first, then files, each sorted by name (case-insensitive). Cached per graph. */
export function treeChildren(index: GraphIndex, directoryId: string): TreeChild[] {
  let cache = childrenCache.get(index);
  if (!cache) {
    cache = new Map();
    childrenCache.set(index, cache);
  }
  const cached = cache.get(directoryId);
  if (cached) return cached;
  const directory = index.directoriesById.get(directoryId);
  if (!directory) return [];
  const directories: TreeChild[] = [];
  for (const id of directory.childDirectoryIds) {
    const child = index.directoriesById.get(id);
    if (child) directories.push({ kind: "directory", id, name: child.name });
  }
  const files: TreeChild[] = [];
  for (const id of directory.fileIds) {
    const file = index.filesById.get(id);
    if (file) files.push({ kind: "file", id, name: file.name });
  }
  const result = [...directories.sort(byName), ...files.sort(byName)];
  cache.set(directoryId, result);
  return result;
}

export function moreRowId(directoryId: string): string {
  return `more:${directoryId}`;
}

/**
 * Rows currently visible in the tree, in display order. `pages` holds how many
 * children are revealed per directory (default TREE_PAGE_SIZE).
 */
export function visibleRows(
  index: GraphIndex,
  expanded: ReadonlySet<string>,
  pages: ReadonlyMap<string, number> = new Map(),
): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (directoryId: string, parentId: string | null, level: number) => {
    const children = treeChildren(index, directoryId);
    const limit = Math.min(children.length, pages.get(directoryId) ?? TREE_PAGE_SIZE);
    for (let i = 0; i < limit; i += 1) {
      const child = children[i];
      if (!child) continue;
      rows.push({
        kind: child.kind,
        id: child.id,
        name: child.name,
        parentId,
        level,
        posinset: i + 1,
        setsize: children.length,
      });
      if (child.kind === "directory" && expanded.has(child.id))
        visit(child.id, child.id, level + 1);
    }
    if (limit < children.length) {
      rows.push({
        kind: "more",
        id: moreRowId(directoryId),
        name: "Show more",
        parentId,
        level,
        posinset: limit + 1,
        setsize: children.length,
        remaining: children.length - limit,
      });
    }
  };
  visit(index.graph.rootDirectoryId, null, 1);
  return rows;
}

export type TreeAction =
  | { type: "focus"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  /** Enter/Space on a file or directory. */
  | { type: "activate"; id: string; kind: "directory" | "file" }
  /** Enter/Space on a "show more" row. */
  | { type: "more"; directoryId: string };

/** WAI-ARIA tree keyboard behaviour. Returns null for keys the tree does not handle. */
export function treeKeyAction(
  rows: readonly TreeRow[],
  focusedId: string | null,
  key: string,
  expanded: ReadonlySet<string>,
): TreeAction | null {
  if (rows.length === 0) return null;
  const position = Math.max(
    0,
    rows.findIndex((row) => row.id === focusedId),
  );
  const row = rows[position];
  if (!row) return null;
  const focusAt = (i: number): TreeAction | null => {
    const target = rows[i];
    return target ? { type: "focus", id: target.id } : null;
  };

  switch (key) {
    case "ArrowDown":
      return focusAt(Math.min(rows.length - 1, position + 1));
    case "ArrowUp":
      return focusAt(Math.max(0, position - 1));
    case "Home":
      return focusAt(0);
    case "End":
      return focusAt(rows.length - 1);
    case "ArrowRight":
      if (row.kind !== "directory") return null;
      if (!expanded.has(row.id)) return { type: "expand", id: row.id };
      // Expanded: move to the first child, if any.
      return rows[position + 1]?.parentId === row.id ? focusAt(position + 1) : null;
    case "ArrowLeft":
      if (row.kind === "directory" && expanded.has(row.id)) return { type: "collapse", id: row.id };
      return row.parentId ? { type: "focus", id: row.parentId } : null;
    case "Enter":
    case " ":
      if (row.kind === "more") return { type: "more", directoryId: row.id.slice("more:".length) };
      return { type: "activate", id: row.id, kind: row.kind };
    default:
      return null;
  }
}

/** Type-ahead: next row after the focused one whose name starts with `character` (wrapping). */
export function typeaheadTarget(
  rows: readonly TreeRow[],
  focusedId: string | null,
  character: string,
): string | null {
  const needle = character.toLowerCase();
  if (!needle.trim() || rows.length === 0) return null;
  const start = rows.findIndex((row) => row.id === focusedId);
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const row = rows[(start + offset + rows.length) % rows.length];
    if (row && row.kind !== "more" && row.name.toLowerCase().startsWith(needle)) return row.id;
  }
  return null;
}

/** Directory ids that must be expanded to reveal a node (its ancestors, excluding the root). */
export function ancestorsToReveal(index: GraphIndex, nodeId: string): string[] {
  const file = index.filesById.get(nodeId);
  const directoryId = file ? file.directoryId : index.directoriesById.get(nodeId)?.parentId;
  if (!directoryId) return [];
  return index.ancestorsOf(directoryId).filter((id) => id !== index.graph.rootDirectoryId);
}

/**
 * Page sizes needed so that `nodeId` is rendered: for each directory on the
 * path, enough children are revealed to include the next step of the path.
 * Returns `pages` unchanged (same reference) when nothing needs to change.
 */
export function revealPages(
  index: GraphIndex,
  nodeId: string,
  pages: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const chain = [index.graph.rootDirectoryId, ...ancestorsToReveal(index, nodeId), nodeId];
  let next: Map<string, number> | null = null;
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const directoryId = chain[i];
    const childId = chain[i + 1];
    if (!directoryId || !childId) continue;
    const position = treeChildren(index, directoryId).findIndex((child) => child.id === childId);
    if (position === -1) continue;
    const shown = (next ?? pages).get(directoryId) ?? TREE_PAGE_SIZE;
    if (position < shown) continue;
    next ??= new Map(pages);
    next.set(directoryId, Math.ceil((position + 1) / TREE_PAGE_SIZE) * TREE_PAGE_SIZE);
  }
  return next ?? pages;
}
