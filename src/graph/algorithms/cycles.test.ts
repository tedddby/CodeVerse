import { describe, expect, it } from "vitest";
import { dependencyEdgeId } from "@/graph/model/ids";
import type { DependencyEdge, DependencyKind } from "@/graph/model/types";
import { findImportCycles } from "./cycles";

function edge(source: string, target: string, kind: DependencyKind = "import"): DependencyEdge {
  const from = `file:${source}`;
  const to = `file:${target}`;
  return { id: dependencyEdgeId(kind, from, to), source: from, target: to, kind, weight: 1 };
}

describe("findImportCycles", () => {
  it("finds strongly connected components with more than one file, largest first", () => {
    const dependencies = [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "a"),
      edge("c", "d"),
      edge("x", "y"),
      edge("y", "x"),
      edge("d", "e"),
      edge("a", "b", "type-import"),
    ];
    const cycles = findImportCycles({ dependencies });
    expect(cycles.map((cycle) => cycle.fileIds)).toEqual([
      ["file:a", "file:b", "file:c"],
      ["file:x", "file:y"],
    ]);
    expect(cycles[0]?.edgeIds).toEqual(
      [
        edge("a", "b").id,
        edge("a", "b", "type-import").id,
        edge("b", "c").id,
        edge("c", "a").id,
      ].sort(),
    );
  });

  it("can restrict edge kinds (e.g. runtime-only cycles)", () => {
    const dependencies = [edge("a", "b"), edge("b", "a", "type-import")];
    expect(findImportCycles({ dependencies })).toHaveLength(1);
    expect(
      findImportCycles({ dependencies }, { kinds: ["import", "require", "dynamic-import"] }),
    ).toEqual([]);
  });

  it("returns nothing for acyclic graphs, ignores self-edges and respects the limit", () => {
    expect(
      findImportCycles({ dependencies: [edge("a", "b"), edge("b", "c"), edge("a", "a")] }),
    ).toEqual([]);
    const pairs = Array.from({ length: 10 }, (_, index) => [
      edge(`p${index}`, `q${index}`),
      edge(`q${index}`, `p${index}`),
    ]).flat();
    expect(findImportCycles({ dependencies: pairs }, { limit: 3 })).toHaveLength(3);
  });

  it("handles very deep chains without overflowing the stack", () => {
    const length = 50_000;
    const dependencies = Array.from({ length }, (_, index) =>
      edge(`n${index}`, `n${(index + 1) % length}`),
    );
    const cycles = findImportCycles({ dependencies });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.fileIds).toHaveLength(length);
  });

  it("is independent of edge order", () => {
    const dependencies = [
      edge("a", "b"),
      edge("b", "a"),
      edge("b", "c"),
      edge("c", "b"),
      edge("d", "a"),
    ];
    expect(findImportCycles({ dependencies: [...dependencies].reverse() })).toEqual(
      findImportCycles({ dependencies }),
    );
  });
});
