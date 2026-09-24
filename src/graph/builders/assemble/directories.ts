import { baseName, directoryId, parentPath } from "@/graph/model/ids";
import type { DirectoryNode, FileNode } from "@/graph/model/types";
import type { InventoryFile } from "../inventory";
import { estimateLines } from "../line-estimate";
import { compareStrings, sortRecordKeys } from "../sort";
import { isOwnFile } from "./own-files";

/**
 * DirectoryNode construction. Every directory of the repository becomes a
 * node — including directories whose files were all omitted from the graph —
 * so directory-first mode can still draw districts for them. Statistics always
 * describe the whole repository (omitted files included); `fileIds` lists only
 * the files that are FileNodes. Line totals count the repository's own code
 * only (see `isOwnFile`): a lockfile or a vendored tree would otherwise dwarf
 * it. As for language statistics, everything counts when nothing else exists.
 */

export interface DirectoryBuildInput {
  repositoryName: string;
  /** Every inventory directory path (the root "" and all ancestors are added if missing). */
  directories: readonly string[];
  /** Every inventory file (graph and omitted). */
  inventoryFiles: readonly InventoryFile[];
  /** FileNodes by path. */
  graphFiles: ReadonlyMap<string, FileNode>;
}

function depthOf(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

/** Lines contributed by a file: the FileNode's count, or a size estimate for omitted files. */
export function linesContribution(
  file: InventoryFile,
  node: FileNode | undefined,
): { lines: number; estimated: boolean } {
  if (node) return { lines: node.lines, estimated: node.linesEstimated };
  if (file.isBinary) return { lines: 0, estimated: false };
  return { lines: estimateLines(file.size, file.language), estimated: file.size > 0 };
}

export function buildDirectories(input: DirectoryBuildInput): DirectoryNode[] {
  const paths = new Set<string>([""]);
  const addWithAncestors = (path: string): void => {
    let current = path;
    while (!paths.has(current)) {
      paths.add(current);
      current = parentPath(current);
    }
  };
  for (const directory of input.directories) addWithAncestors(directory);
  for (const file of input.inventoryFiles) addWithAncestors(parentPath(file.path));

  const nodes = new Map<string, DirectoryNode>();
  for (const path of [...paths].sort(compareStrings)) {
    nodes.set(path, {
      id: directoryId(path),
      path,
      name: path === "" ? input.repositoryName : baseName(path),
      parentId: path === "" ? null : directoryId(parentPath(path)),
      depth: depthOf(path),
      childDirectoryIds: [],
      fileIds: [],
      stats: {
        fileCount: 0,
        directFileCount: 0,
        directDirectoryCount: 0,
        totalLines: 0,
        linesEstimated: false,
        totalBytes: 0,
        symbolCount: 0,
        omittedFileCount: 0,
        languageBytes: {},
      },
    });
  }

  for (const node of nodes.values()) {
    if (node.path === "") continue;
    nodes.get(parentPath(node.path))?.childDirectoryIds.push(node.id);
  }

  const countAllLines = !input.inventoryFiles.some(isOwnFile);
  for (const file of input.inventoryFiles) {
    const directory = nodes.get(parentPath(file.path));
    if (!directory) continue;
    const graphNode = input.graphFiles.get(file.path);
    const stats = directory.stats;
    stats.fileCount += 1;
    stats.directFileCount += 1;
    stats.totalBytes += file.size;
    if (countAllLines || isOwnFile(file)) {
      const contribution = linesContribution(file, graphNode);
      stats.totalLines += contribution.lines;
      stats.linesEstimated ||= contribution.estimated;
    }
    stats.languageBytes[file.language] = (stats.languageBytes[file.language] ?? 0) + file.size;
    if (graphNode) {
      directory.fileIds.push(graphNode.id);
      stats.symbolCount += graphNode.symbolIds.length;
    } else {
      stats.omittedFileCount += 1;
    }
  }

  // Roll statistics up, deepest directories first.
  const bottomUp = [...nodes.values()].sort(
    (a, b) => b.depth - a.depth || compareStrings(a.path, b.path),
  );
  for (const node of bottomUp) {
    node.childDirectoryIds.sort(compareStrings);
    node.fileIds.sort(compareStrings);
    node.stats.directDirectoryCount = node.childDirectoryIds.length;
    if (node.path === "") continue;
    const parent = nodes.get(parentPath(node.path));
    if (!parent) continue;
    const from = node.stats;
    const to = parent.stats;
    to.fileCount += from.fileCount;
    to.totalBytes += from.totalBytes;
    to.totalLines += from.totalLines;
    to.linesEstimated ||= from.linesEstimated;
    to.symbolCount += from.symbolCount;
    to.omittedFileCount += from.omittedFileCount;
    for (const [language, bytes] of Object.entries(from.languageBytes)) {
      to.languageBytes[language] = (to.languageBytes[language] ?? 0) + bytes;
    }
  }

  const result = [...nodes.values()];
  for (const node of result) node.stats.languageBytes = sortRecordKeys(node.stats.languageBytes);
  return result;
}
