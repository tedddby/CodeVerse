import type { DependencyEdge } from "@/graph/model/types";
import { budgetDependencyEdges } from "./edges";

function edge(source: string, target: string, weight = 1): DependencyEdge {
  return { id: `import:${source}->${target}`, source, target, kind: "import", weight };
}

const all = () => true;

describe("budgetDependencyEdges", () => {
  const edges = [
    edge("a", "b", 3),
    edge("b", "c", 1),
    edge("c", "a", 5),
    edge("d", "a", 2),
    edge("e", "f", 9),
    edge("a", "a", 4),
  ];

  it("returns only the selection's incoming and outgoing edges with roles", () => {
    const result = budgetDependencyEdges(edges, {
      selectedFileIds: new Set(["a"]),
      focusFileIds: null,
      isDrawable: all,
    });
    const byId = new Map(result.map((r) => [r.edge.id, r.role]));
    expect(byId.get("import:a->b")).toBe("outgoing");
    expect(byId.get("import:c->a")).toBe("incoming");
    expect(byId.get("import:d->a")).toBe("incoming");
    expect(byId.has("import:e->f")).toBe(false);
    // Self-edges are never drawable.
    expect(byId.has("import:a->a")).toBe(false);
  });

  it("marks edges inside a selected group as internal", () => {
    const result = budgetDependencyEdges(edges, {
      selectedFileIds: new Set(["a", "b"]),
      focusFileIds: null,
      isDrawable: all,
    });
    expect(result.find((r) => r.edge.id === "import:a->b")?.role).toBe("internal");
    expect(result.find((r) => r.edge.id === "import:b->c")?.role).toBe("outgoing");
  });

  it("keeps only edges inside the focused subtree", () => {
    const result = budgetDependencyEdges(edges, {
      selectedFileIds: new Set(),
      focusFileIds: new Set(["a", "b", "c"]),
      isDrawable: all,
    });
    expect(result.map((r) => r.edge.id).sort()).toEqual([
      "import:a->b",
      "import:b->c",
      "import:c->a",
    ]);
    expect(result.every((r) => r.role === "focus")).toBe(true);
  });

  it("returns the heaviest edges within the overview budget, deterministically", () => {
    const result = budgetDependencyEdges(edges, {
      selectedFileIds: new Set(),
      focusFileIds: null,
      isDrawable: all,
      overviewBudget: 2,
    });
    expect(result.map((r) => r.edge.id)).toEqual(["import:e->f", "import:c->a"]);
  });

  it("breaks weight ties by id", () => {
    const tied = [edge("z", "y"), edge("m", "n"), edge("b", "c")];
    const result = budgetDependencyEdges(tied, {
      selectedFileIds: new Set(),
      focusFileIds: null,
      isDrawable: all,
      overviewBudget: 2,
    });
    expect(result.map((r) => r.edge.id)).toEqual(["import:b->c", "import:m->n"]);
  });

  it("skips edges whose endpoints have no building", () => {
    const result = budgetDependencyEdges(edges, {
      selectedFileIds: new Set(),
      focusFileIds: null,
      isDrawable: (id) => id !== "f",
    });
    expect(result.some((r) => r.edge.id === "import:e->f")).toBe(false);
  });

  it("caps selection edges with the safety budget", () => {
    const star = Array.from({ length: 50 }, (_, i) => edge("hub", `leaf${i}`, i));
    const result = budgetDependencyEdges(star, {
      selectedFileIds: new Set(["hub"]),
      focusFileIds: null,
      isDrawable: all,
      selectionBudget: 10,
    });
    expect(result).toHaveLength(10);
    expect(result[0]?.edge.weight).toBe(49);
  });

  it("does not mutate the input array order", () => {
    const input = [edge("a", "b", 1), edge("c", "d", 5)];
    budgetDependencyEdges(input, {
      selectedFileIds: new Set(),
      focusFileIds: null,
      isDrawable: all,
    });
    expect(input.map((e) => e.weight)).toEqual([1, 5]);
  });
});
