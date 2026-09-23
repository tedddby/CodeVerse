import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { LayoutDirectoryInput, LayoutFileInput, LayoutGraphInput } from "./layout-input";
import { buildLayoutTree } from "./layout-tree";

function directory(
  path: string,
  parentPath: string | null,
  omitted = 0,
  directFileCount = 0,
): LayoutDirectoryInput {
  return {
    id: `dir:${path}`,
    path,
    name: path.split("/").pop() ?? "",
    parentId: parentPath === null ? null : `dir:${parentPath}`,
    stats: { omittedFileCount: omitted, directFileCount },
  };
}

function file(path: string, directoryPath: string): LayoutFileInput {
  return {
    id: `file:${path}`,
    path,
    size: 100,
    lines: 10,
    directoryId: `dir:${directoryPath}`,
    status: "parsed",
  };
}

function input(directories: LayoutDirectoryInput[], files: LayoutFileInput[]): LayoutGraphInput {
  return {
    repository: { id: "test:repo", commitSha: "abc" },
    rootDirectoryId: "dir:",
    directories,
    files,
    dependencies: [],
  };
}

describe("buildLayoutTree", () => {
  it("mirrors a consistent graph: levels equal depths, children sorted by path", () => {
    const tree = buildLayoutTree(mockRepositoryGraph);
    expect(tree.preorder).toHaveLength(mockRepositoryGraph.directories.length);
    for (const node of tree.preorder) {
      const original = mockRepositoryGraph.directories.find((item) => item.id === node.id);
      expect(node.level).toBe(original?.depth);
      const childPaths = node.children.map((child) => child.path);
      expect(childPaths).toEqual([...childPaths].sort());
    }
    expect(tree.preorder[0]).toBe(tree.root);
    expect(tree.directoryOfFile.size).toBe(mockRepositoryGraph.files.length);
  });

  it("skips directories without files but keeps omitted-only ones and the root", () => {
    const tree = buildLayoutTree(
      input(
        [
          directory("", null, 7),
          directory("empty", ""),
          directory("empty/nested", "empty"),
          directory("vendor", "", 7),
          directory("vendor/lib", "vendor", 5),
        ],
        [],
      ),
    );
    expect(tree.preorder.map((node) => node.id)).toEqual(["dir:", "dir:vendor", "dir:vendor/lib"]);
    const vendor = tree.preorder.find((node) => node.id === "dir:vendor");
    expect(vendor?.directOmitted).toBe(2);
    expect(tree.root.directOmitted).toBe(0);
  });

  it("derives direct omitted files from directFileCount when recursive counts are missing", () => {
    const tree = buildLayoutTree(
      input([directory("", null), directory("docs", "", 0, 5)], [file("docs/a.md", "docs")]),
    );
    expect(tree.preorder.find((node) => node.id === "dir:docs")?.directOmitted).toBe(4);
  });

  it("re-homes orphans and cycles under the root deterministically", () => {
    const tree = buildLayoutTree(
      input(
        [
          directory("", null),
          { ...directory("a", ""), parentId: "dir:b" },
          { ...directory("b", ""), parentId: "dir:a" },
          { ...directory("lost", ""), parentId: "dir:missing" },
          { ...directory("self", ""), parentId: "dir:self" },
        ],
        [
          file("a/x.ts", "a"),
          file("b/y.ts", "b"),
          file("lost/z.ts", "lost"),
          file("self/w.ts", "self"),
          file("ghost/v.ts", "ghost"),
        ],
      ),
    );
    const byId = new Map(tree.preorder.map((node) => [node.id, node] as const));
    expect(tree.root.children.map((node) => node.id)).toEqual(["dir:lost", "dir:self", "dir:a"]);
    expect(byId.get("dir:b")?.level).toBe(2);
    expect(tree.directoryOfFile.get("file:ghost/v.ts")).toBe("dir:");
    expect(tree.directoryOfFile.size).toBe(5);
  });

  it("deduplicates repeated ids and synthesizes a missing root", () => {
    const tree = buildLayoutTree(
      input(
        [directory("src", ""), directory("src", "")],
        [file("src/a.ts", "src"), file("src/a.ts", "src")],
      ),
    );
    expect(tree.root.id).toBe("dir:");
    expect(tree.preorder.map((node) => node.id)).toEqual(["dir:", "dir:src"]);
    expect(tree.preorder[1]?.files).toHaveLength(1);
  });
});
