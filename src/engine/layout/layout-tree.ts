import { compareStrings, finiteNonNegative } from "./geometry";
import type { LayoutDirectoryInput, LayoutFileInput, LayoutGraphInput } from "./layout-input";

/**
 * Normalized directory tree the planner works on.
 *
 * District rule (relied upon by the renderer):
 * - The root directory ALWAYS gets a district (even for an empty repository),
 *   so the world has a ground to stand on.
 * - Any other directory gets a district if and only if it contains, directly or
 *   below, at least one graph file or at least one omitted file
 *   (`stats.omittedFileCount` / `stats.directFileCount` beyond the graph files).
 * - Directories that contain no files at all are skipped (no district).
 *
 * The tree is rebuilt defensively and deterministically from the input:
 * - duplicate directory/file ids keep the first entry in (id, path) order;
 * - the parent of a directory is `parentId`; directories whose parent is unknown
 *   (or that form a cycle) are attached to the root;
 * - files whose `directoryId` is unknown are placed in the root district, so
 *   every file node always gets exactly one building;
 * - children and files are ordered by path (code-unit order), never by the
 *   order of the input arrays.
 */
export interface LayoutDirectory {
  id: string;
  path: string;
  name: string;
  /** Nesting level in the layout tree (root = 0; equals `DirectoryNode.depth` for consistent graphs). */
  level: number;
  /** Content-bearing child directories, sorted by path. */
  children: LayoutDirectory[];
  /** Graph files directly inside, sorted by path. */
  files: LayoutFileInput[];
  /** Files directly inside that exist in the repository but are not graph nodes. */
  directOmitted: number;
}

export interface LayoutTree {
  root: LayoutDirectory;
  /** Content-bearing directories in pre-order (root first, children by path). */
  preorder: LayoutDirectory[];
  /** Directory id owning each file id (after orphan re-homing). */
  directoryOfFile: Map<string, string>;
}

interface MutableDirectory {
  input: LayoutDirectoryInput;
  node: LayoutDirectory;
  /** All child directories (content-bearing or not), sorted by path before traversal. */
  allChildren: MutableDirectory[];
  /** Recursive omitted count reported by the producer. */
  reportedOmitted: number;
  hasContent: boolean;
}

function compareByPathThenId(
  a: { path: string; id: string },
  b: { path: string; id: string },
): number {
  return compareStrings(a.path, b.path) || compareStrings(a.id, b.id);
}

function uniqueById<T extends { id: string; path: string }>(items: readonly T[]): T[] {
  const sorted = [...items].sort(
    (a, b) => compareStrings(a.id, b.id) || compareStrings(a.path, b.path),
  );
  const result: T[] = [];
  let previousId: string | null = null;
  for (const item of sorted) {
    if (item.id === previousId) continue;
    previousId = item.id;
    result.push(item);
  }
  return result;
}

function createMutable(input: LayoutDirectoryInput): MutableDirectory {
  return {
    input,
    node: {
      id: input.id,
      path: input.path,
      name: input.name,
      level: 0,
      children: [],
      files: [],
      directOmitted: 0,
    },
    allChildren: [],
    reportedOmitted: Math.floor(finiteNonNegative(input.stats.omittedFileCount)),
    hasContent: false,
  };
}

export function buildLayoutTree(input: LayoutGraphInput): LayoutTree {
  const directories = uniqueById(input.directories);
  const byId = new Map<string, MutableDirectory>();
  for (const directory of directories) byId.set(directory.id, createMutable(directory));

  let root = byId.get(input.rootDirectoryId);
  if (!root) {
    // The producer did not include the root node: synthesize one so the world
    // still has a single enclosing district with the declared root id.
    root = createMutable({
      id: input.rootDirectoryId,
      path: "",
      name: "",
      parentId: null,
      stats: { omittedFileCount: 0, directFileCount: 0 },
    });
    byId.set(root.input.id, root);
  }

  // Parent links (deterministic: `directories` is sorted by id).
  for (const directory of directories) {
    const mutable = byId.get(directory.id);
    if (!mutable || mutable === root) continue;
    const parentId = directory.parentId;
    const parent = parentId !== null && parentId !== directory.id ? byId.get(parentId) : undefined;
    (parent ?? root).allChildren.push(mutable);
  }
  for (const mutable of byId.values()) {
    mutable.allChildren.sort((a, b) => compareByPathThenId(a.input, b.input));
  }

  // Pre-order traversal from the root; unreachable directories (parent cycles)
  // are attached to the root in path order.
  const visited = new Set<MutableDirectory>();
  const order: MutableDirectory[] = [];
  const parentOf = new Map<MutableDirectory, MutableDirectory>();
  const traverse = (start: MutableDirectory) => {
    const stack: MutableDirectory[] = [start];
    visited.add(start);
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      order.push(current);
      const children = current.allChildren;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (!child || visited.has(child)) continue;
        visited.add(child);
        parentOf.set(child, current);
        child.node.level = current.node.level + 1;
        stack.push(child);
      }
    }
  };
  traverse(root);
  if (visited.size < byId.size) {
    const orphans = [...byId.values()]
      .filter((mutable) => !visited.has(mutable))
      .sort((a, b) => compareByPathThenId(a.input, b.input));
    for (const orphan of orphans) {
      if (visited.has(orphan)) continue;
      root.allChildren.push(orphan);
      parentOf.set(orphan, root);
      orphan.node.level = 1;
      traverse(orphan);
    }
  }

  // Files: each unique file id lands in exactly one directory.
  const directoryOfFile = new Map<string, string>();
  const files = uniqueById(input.files).sort(compareByPathThenId);
  for (const file of files) {
    const owner = byId.get(file.directoryId);
    const target = owner && visited.has(owner) ? owner : root;
    target.node.files.push(file);
    directoryOfFile.set(file.id, target.node.id);
  }

  // Post-order: omitted counts and content flags.
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const mutable = order[index];
    if (!mutable) continue;
    let childOmitted = 0;
    let childHasContent = false;
    for (const child of mutable.allChildren) {
      if (parentOf.get(child) !== mutable) continue;
      childOmitted += child.reportedOmitted;
      if (child.hasContent) childHasContent = true;
    }
    const byRecursiveCount = mutable.reportedOmitted - childOmitted;
    const byDirectCount =
      Math.floor(finiteNonNegative(mutable.input.stats.directFileCount)) -
      mutable.node.files.length;
    mutable.node.directOmitted = Math.max(0, byRecursiveCount, byDirectCount);
    mutable.hasContent =
      mutable.node.files.length > 0 || mutable.node.directOmitted > 0 || childHasContent;
  }

  // Materialize content-bearing children and the pre-order list.
  const preorder: LayoutDirectory[] = [];
  for (const mutable of order) {
    if (mutable !== root && !mutable.hasContent) continue;
    preorder.push(mutable.node);
    for (const child of mutable.allChildren) {
      if (parentOf.get(child) === mutable && child.hasContent)
        mutable.node.children.push(child.node);
    }
  }

  return { root: root.node, preorder, directoryOfFile };
}
