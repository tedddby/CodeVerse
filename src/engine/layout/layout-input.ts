import type {
  DependencyEdge,
  DirectoryNode,
  DirectoryStats,
  FileNode,
  RepositoryInfo,
} from "@/graph/model/types";

/**
 * The subset of a `RepositoryGraph` the layout engine reads.
 *
 * `RepositoryGraph` is structurally assignable to `LayoutGraphInput`, so
 * `computeWorldLayout(graph)` accepts a full graph directly. The compact form
 * produced by `toLayoutInput` is what the hook posts to the layout worker:
 * it omits symbols, imports, commits and every other field the layout does not
 * need, which keeps the structured-clone cost of a 25k-file graph small.
 */
export interface LayoutDirectoryInput {
  id: DirectoryNode["id"];
  path: DirectoryNode["path"];
  name: DirectoryNode["name"];
  parentId: DirectoryNode["parentId"];
  stats: Pick<DirectoryStats, "omittedFileCount" | "directFileCount">;
}

export type LayoutFileInput = Pick<
  FileNode,
  "id" | "path" | "size" | "lines" | "directoryId" | "status"
>;

export type LayoutDependencyInput = Pick<DependencyEdge, "source" | "target" | "weight">;

export interface LayoutGraphInput {
  repository: Pick<RepositoryInfo, "id" | "commitSha">;
  rootDirectoryId: string;
  directories: LayoutDirectoryInput[];
  files: LayoutFileInput[];
  dependencies: LayoutDependencyInput[];
}

/** Copies only the fields the layout engine reads (see `LayoutGraphInput`). */
export function toLayoutInput(graph: LayoutGraphInput): LayoutGraphInput {
  return {
    repository: { id: graph.repository.id, commitSha: graph.repository.commitSha },
    rootDirectoryId: graph.rootDirectoryId,
    directories: graph.directories.map((directory) => ({
      id: directory.id,
      path: directory.path,
      name: directory.name,
      parentId: directory.parentId,
      stats: {
        omittedFileCount: directory.stats.omittedFileCount,
        directFileCount: directory.stats.directFileCount,
      },
    })),
    files: graph.files.map((file) => ({
      id: file.id,
      path: file.path,
      size: file.size,
      lines: file.lines,
      directoryId: file.directoryId,
      status: file.status,
    })),
    dependencies: graph.dependencies.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    })),
  };
}

/** Layout key: identifies the repository snapshot a layout belongs to. */
export function layoutKey(graph: Pick<LayoutGraphInput, "repository">): string {
  return `${graph.repository.id}@${graph.repository.commitSha}`;
}
