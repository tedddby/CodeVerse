import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { dependencyEdgeId } from "@/graph/model/ids";
import type { DependencyEdge, DependencyKind, RepositoryGraph } from "@/graph/model/types";
import { rankFilesByConnectivity } from "./connectivity";

function edge(
  source: string,
  target: string,
  weight = 1,
  kind: DependencyKind = "import",
): DependencyEdge {
  const from = `file:${source}`;
  const to = `file:${target}`;
  return { id: dependencyEdgeId(kind, from, to), source: from, target: to, kind, weight };
}

const graphWith = (dependencies: DependencyEdge[]): RepositoryGraph => ({
  ...mockRepositoryGraph,
  dependencies,
});

describe("rankFilesByConnectivity", () => {
  it("ranks by distinct neighbours, then dependants, then weight, then id", () => {
    const graph = graphWith([
      edge("app", "core", 3),
      edge("app", "core", 1, "type-import"),
      edge("cli", "core"),
      edge("core", "util"),
      edge("app", "util"),
      edge("app", "ui"),
    ]);
    const ranking = rankFilesByConnectivity(graph, 10);
    // core and app both have 3 distinct neighbours; core wins on dependants.
    expect(ranking[0]).toEqual({
      fileId: "file:core",
      importedBy: 2,
      imports: 1,
      degree: 3,
      weight: 6,
    });
    expect(ranking[1]).toEqual({
      fileId: "file:app",
      importedBy: 0,
      imports: 3,
      degree: 3,
      weight: 6,
    });
    // ui and cli both have one neighbour; ui is imported, cli only imports.
    expect(ranking.map((entry) => entry.fileId)).toEqual([
      "file:core",
      "file:app",
      "file:util",
      "file:ui",
      "file:cli",
    ]);
  });

  it("accepts a GraphIndex and respects the limit", () => {
    const index = buildGraphIndex(mockRepositoryGraph);
    const fromIndex = rankFilesByConnectivity(index, 3);
    expect(fromIndex).toHaveLength(3);
    expect(fromIndex).toEqual(rankFilesByConnectivity(mockRepositoryGraph, 3));
    for (let position = 1; position < fromIndex.length; position += 1) {
      expect(fromIndex[position - 1]?.degree ?? 0).toBeGreaterThanOrEqual(
        fromIndex[position]?.degree ?? 0,
      );
    }
  });

  it("returns nothing for graphs without dependencies", () => {
    expect(rankFilesByConnectivity(graphWith([]))).toEqual([]);
    expect(rankFilesByConnectivity(graphWith([edge("a", "b")]), 0)).toEqual([]);
  });
});
