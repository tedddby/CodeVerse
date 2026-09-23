import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { createSyntheticGraph } from "./fixture-builder";
import { mockRepositoryGraph } from "./mock-repository-graph";

describe("mockRepositoryGraph", () => {
  it("is internally consistent", () => {
    const index = buildGraphIndex(mockRepositoryGraph);
    for (const file of mockRepositoryGraph.files) {
      expect(index.directoriesById.get(file.directoryId)?.fileIds).toContain(file.id);
      for (const sid of file.symbolIds) expect(index.symbolsById.get(sid)?.fileId).toBe(file.id);
    }
    for (const edge of mockRepositoryGraph.dependencies) {
      expect(index.filesById.has(edge.source)).toBe(true);
      expect(index.filesById.has(edge.target)).toBe(true);
    }
    const root = index.directoriesById.get(mockRepositoryGraph.rootDirectoryId);
    expect(root?.stats.fileCount).toBe(mockRepositoryGraph.files.length);
    expect(root?.stats.totalLines).toBe(mockRepositoryGraph.files.reduce((s, f) => s + f.lines, 0));
  });

  it("has history, contributors and multiple languages", () => {
    expect(mockRepositoryGraph.commits.length).toBeGreaterThan(10);
    expect(mockRepositoryGraph.contributors.every((c) => c.commitCount > 0)).toBe(true);
    expect(mockRepositoryGraph.languages.map((l) => l.id)).toEqual(
      expect.arrayContaining(["typescript", "python", "go", "rust", "java"]),
    );
    expect(mockRepositoryGraph.timeline.buckets.length).toBeGreaterThan(0);
  });
});

describe("createSyntheticGraph", () => {
  it("is deterministic for a seed", () => {
    const a = createSyntheticGraph({ fileCount: 500, seed: 7 });
    const b = createSyntheticGraph({ fileCount: 500, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.files).toHaveLength(500);
  });

  it("scales to large repositories", () => {
    const graph = createSyntheticGraph({ fileCount: 20_000, seed: 1 });
    expect(graph.files).toHaveLength(20_000);
    expect(graph.directories.length).toBeGreaterThan(100);
  });
});
