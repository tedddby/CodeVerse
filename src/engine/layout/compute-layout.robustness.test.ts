import { describe, expect, it } from "vitest";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { directoryId } from "@/graph/model/ids";
import type { DirectoryNode, RepositoryGraph } from "@/graph/model/types";
import { computeWorldLayout, DEFAULT_LAYOUT_OPTIONS } from "./compute-layout";
import { collectLayoutViolations } from "./test-support";
import type { WorldLayout } from "./types";

/** Edge cases and malformed input: the layout must stay valid, never throw. */
const REFERENCE_DATE = "2026-09-01T00:00:00.000Z";

function fixture(files: Array<{ path: string; lines: number; size?: number; imports?: string[] }>) {
  return buildFixtureGraph({ owner: "test", name: "repo", referenceDate: REFERENCE_DATE, files });
}

function districtOf(layout: WorldLayout, id: string) {
  const district = layout.districts.find((item) => item.id === id);
  if (!district) throw new Error(`no district ${id}`);
  return district;
}

function buildingOf(layout: WorldLayout, id: string) {
  const building = layout.buildings.find((item) => item.id === id);
  if (!building) throw new Error(`no building ${id}`);
  return building;
}

/** Adds a directory that has no graph files but `omitted` repository files directly inside. */
function addOmittedDirectory(graph: RepositoryGraph, path: string, omitted: number): void {
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const parent = graph.directories.find((directory) => directory.path === parentPath);
  if (!parent) throw new Error(`no parent for ${path}`);
  const node: DirectoryNode = {
    id: directoryId(path),
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    parentId: parent.id,
    depth: parent.depth + 1,
    childDirectoryIds: [],
    fileIds: [],
    stats: {
      fileCount: omitted,
      directFileCount: omitted,
      directDirectoryCount: 0,
      totalLines: 0,
      linesEstimated: false,
      totalBytes: 0,
      symbolCount: 0,
      omittedFileCount: omitted,
      languageBytes: {},
    },
  };
  graph.directories.push(node);
  parent.childDirectoryIds.push(node.id);
  let ancestor: DirectoryNode | undefined = parent;
  while (ancestor) {
    ancestor.stats.omittedFileCount += omitted;
    ancestor.stats.fileCount += omitted;
    const ancestorParentId: string | null = ancestor.parentId;
    ancestor = graph.directories.find((directory) => directory.id === ancestorParentId);
  }
}

describe("computeWorldLayout robustness", () => {
  it("handles a single-file repository", () => {
    const graph = fixture([{ path: "main.go", lines: 40 }]);
    const layout = computeWorldLayout(graph);
    expect(layout.districts).toHaveLength(1);
    expect(layout.buildings).toHaveLength(1);
    expect(collectLayoutViolations(graph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual([]);
  });

  it("gives an empty repository a single root district and no buildings", () => {
    const graph = fixture([]);
    const layout = computeWorldLayout(graph);
    expect(layout.buildings).toEqual([]);
    expect(layout.districts.map((district) => district.id)).toEqual([graph.rootDirectoryId]);
    expect(Number.isFinite(layout.bounds.size)).toBe(true);
    expect(layout.bounds.size).toBeGreaterThan(0);
  });

  it("lays out deep directory chains as concentric terraces", () => {
    const path = Array.from({ length: 30 }, (_, index) => `d${index}`).join("/");
    const graph = fixture([
      { path: `${path}/leaf.ts`, lines: 120 },
      { path: "top.ts", lines: 10 },
    ]);
    const layout = computeWorldLayout(graph);
    expect(layout.districts).toHaveLength(31);
    expect(Math.max(...layout.districts.map((district) => district.level))).toBe(30);
    expect(collectLayoutViolations(graph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual([]);
  });

  it("gives omitted-only directories a district sized by their omitted files and skips empty ones", () => {
    const graph = fixture([
      { path: "src/app.ts", lines: 200 },
      { path: "src/util.ts", lines: 50 },
    ]);
    addOmittedDirectory(graph, "vendor", 400);
    addOmittedDirectory(graph, "assets", 40);
    addOmittedDirectory(graph, "vendor/deep", 25);
    addOmittedDirectory(graph, "empty", 0);
    const layout = computeWorldLayout(graph);
    expect(collectLayoutViolations(graph, layout, DEFAULT_LAYOUT_OPTIONS)).toEqual([]);

    const ids = layout.districts.map((district) => district.id);
    expect(ids).toEqual(expect.arrayContaining(["dir:vendor", "dir:vendor/deep", "dir:assets"]));
    expect(ids).not.toContain("dir:empty");
    const area = (id: string) => districtOf(layout, id).width * districtOf(layout, id).depth;
    expect(area("dir:vendor")).toBeGreaterThan(area("dir:assets") * 4);
  });

  it("places files whose directory is unknown in the root district", () => {
    const graph = structuredClone(mockRepositoryGraph);
    const orphan = graph.files.find((file) => file.path === "src/lib/db.ts");
    if (!orphan) throw new Error("fixture changed");
    orphan.directoryId = "dir:does/not/exist";
    const layout = computeWorldLayout(graph);
    expect(buildingOf(layout, orphan.id).districtId).toBe(graph.rootDirectoryId);
    expect(layout.buildings).toHaveLength(graph.files.length);
  });

  it("survives malformed directory parents (cycles, self-parents, missing root)", () => {
    const graph = structuredClone(mockRepositoryGraph);
    const auth = graph.directories.find((directory) => directory.path === "src/auth");
    const users = graph.directories.find((directory) => directory.path === "src/users");
    const lib = graph.directories.find((directory) => directory.path === "src/lib");
    if (!auth || !users || !lib) throw new Error("fixture changed");
    auth.parentId = users.id;
    users.parentId = auth.id;
    lib.parentId = lib.id;
    const layout = computeWorldLayout(graph);
    expect(new Set(layout.buildings.map((building) => building.id)).size).toBe(graph.files.length);
    const withoutRoot = {
      ...mockRepositoryGraph,
      directories: mockRepositoryGraph.directories.filter((directory) => directory.path !== ""),
    };
    const rootless = computeWorldLayout(withoutRoot);
    expect(rootless.districts[0]?.id).toBe(mockRepositoryGraph.rootDirectoryId);
    expect(rootless.buildings).toHaveLength(mockRepositoryGraph.files.length);
  });
});
