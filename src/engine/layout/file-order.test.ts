import { describe, expect, it } from "vitest";
import { buildIntraDirectoryAdjacency, orderFilesForPacking } from "./file-order";
import type { LayoutFileInput } from "./layout-input";

function file(path: string, size: number): LayoutFileInput {
  return { id: `file:${path}`, path, size, lines: 10, directoryId: "dir:", status: "parsed" };
}

const sizeOf = (input: LayoutFileInput) => input.size;
const paths = (files: LayoutFileInput[]) => files.map((input) => input.path);

describe("buildIntraDirectoryAdjacency", () => {
  const directoryOfFile = new Map([
    ["file:a", "dir:x"],
    ["file:b", "dir:x"],
    ["file:c", "dir:y"],
  ]);

  it("keeps only same-directory edges, undirected, with summed integer weights", () => {
    const adjacency = buildIntraDirectoryAdjacency(
      [
        { source: "file:a", target: "file:b", weight: 2 },
        { source: "file:b", target: "file:a", weight: 1 },
        { source: "file:a", target: "file:c", weight: 5 },
        { source: "file:a", target: "file:a", weight: 5 },
        { source: "file:a", target: "file:missing", weight: 5 },
        { source: "file:b", target: "file:a", weight: 0.4 },
      ],
      directoryOfFile,
    );
    expect(adjacency.get("file:a")?.get("file:b")).toBe(4);
    expect(adjacency.get("file:b")?.get("file:a")).toBe(4);
    expect(adjacency.get("file:a")?.has("file:c")).toBe(false);
    expect(adjacency.get("file:a")?.has("file:a")).toBe(false);
    expect(adjacency.has("file:c")).toBe(false);
  });
});

describe("orderFilesForPacking", () => {
  it("orders unconnected files larger first, ties by path", () => {
    const files = [file("a", 10), file("b", 30), file("c", 10), file("d", 20)];
    expect(paths(orderFilesForPacking(files, new Map(), sizeOf))).toEqual(["b", "d", "a", "c"]);
  });

  it("walks dependency clusters from the most connected file, keeping neighbours adjacent", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g"].map((name) => file(name, 10));
    const directoryOfFile = new Map(files.map((input) => [input.id, "dir:"] as const));
    const adjacency = buildIntraDirectoryAdjacency(
      [
        // Cluster 1: hub "e" with spokes c, g; g-a chain.
        { source: "file:c", target: "file:e", weight: 1 },
        { source: "file:e", target: "file:g", weight: 3 },
        { source: "file:g", target: "file:a", weight: 1 },
        // Cluster 2: b-f.
        { source: "file:b", target: "file:f", weight: 1 },
      ],
      directoryOfFile,
    );
    const order = paths(orderFilesForPacking(files, adjacency, sizeOf));
    // e (degree 4) first, strongest edge to g, then g's neighbour a, backtrack to c.
    // Next cluster starts at b (degree ties broken by path), then isolated d.
    expect(order).toEqual(["e", "g", "a", "c", "b", "f", "d"]);
  });

  it("returns every file exactly once", () => {
    const files = Array.from({ length: 50 }, (_, index) => file(`f${index}`, index % 7));
    const directoryOfFile = new Map(files.map((input) => [input.id, "dir:"] as const));
    const edges = files.slice(1).map((input, index) => ({
      source: input.id,
      target: files[(index * 7) % files.length]?.id ?? input.id,
      weight: 1,
    }));
    const order = orderFilesForPacking(
      files,
      buildIntraDirectoryAdjacency(edges, directoryOfFile),
      sizeOf,
    );
    expect(new Set(order.map((input) => input.id)).size).toBe(files.length);
    expect(order).toHaveLength(files.length);
  });
});
