import type { LayoutDependencyInput, LayoutFileInput } from "./layout-input";

/**
 * Deterministic ordering of the files inside one district.
 *
 * The packer places files in sequence (row by row), so consecutive files end
 * up spatially adjacent. We therefore order files by a greedy depth-first walk
 * of the intra-directory dependency graph:
 * 1. start at the most connected file (sum of edge weights), ties by path;
 * 2. always step to the unvisited neighbour with the strongest connection
 *    (ties: larger building first, then path), backtracking when stuck;
 * 3. when a connected component is exhausted, start again from the most
 *    connected remaining file;
 * 4. files without intra-directory dependencies follow, larger first, ties by path.
 */

/** Undirected intra-directory dependency weights: fileId -> neighbour fileId -> weight. */
export type IntraDirectoryAdjacency = Map<string, Map<string, number>>;

function addWeight(adjacency: IntraDirectoryAdjacency, from: string, to: string, weight: number) {
  let neighbours = adjacency.get(from);
  if (!neighbours) {
    neighbours = new Map();
    adjacency.set(from, neighbours);
  }
  neighbours.set(to, (neighbours.get(to) ?? 0) + weight);
}

/**
 * Collapses file-to-file dependencies into undirected weighted adjacency,
 * keeping only edges whose endpoints live in the same district.
 * Weights are rounded to positive integers so sums are exact and therefore
 * independent of the order of the input edges.
 */
export function buildIntraDirectoryAdjacency(
  dependencies: readonly LayoutDependencyInput[],
  directoryOfFile: ReadonlyMap<string, string>,
): IntraDirectoryAdjacency {
  const adjacency: IntraDirectoryAdjacency = new Map();
  for (const edge of dependencies) {
    if (edge.source === edge.target) continue;
    const sourceDirectory = directoryOfFile.get(edge.source);
    if (sourceDirectory === undefined || sourceDirectory !== directoryOfFile.get(edge.target))
      continue;
    const weight =
      typeof edge.weight === "number" && Number.isFinite(edge.weight)
        ? Math.max(1, Math.round(edge.weight))
        : 1;
    addWeight(adjacency, edge.source, edge.target, weight);
    addWeight(adjacency, edge.target, edge.source, weight);
  }
  return adjacency;
}

interface Neighbour {
  index: number;
  weight: number;
}

/**
 * Orders `files` (which must already be sorted by path) for packing.
 * `sizeOf` returns the building footprint used for "larger first" tie-breaks.
 * Runs in O(n log n + e log e) for n files and e intra-directory edges.
 */
export function orderFilesForPacking(
  files: readonly LayoutFileInput[],
  adjacency: IntraDirectoryAdjacency,
  sizeOf: (file: LayoutFileInput) => number,
): LayoutFileInput[] {
  const count = files.length;
  if (count <= 1) return [...files];

  const indexById = new Map<string, number>();
  files.forEach((file, index) => indexById.set(file.id, index));
  const sizes = files.map(sizeOf);

  const neighbours: Neighbour[][] = new Array<Neighbour[]>(count);
  const degree = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const file = files[index];
    const list: Neighbour[] = [];
    const weights = file ? adjacency.get(file.id) : undefined;
    if (weights) {
      for (const [neighbourId, weight] of weights) {
        const neighbourIndex = indexById.get(neighbourId);
        if (neighbourIndex === undefined) continue;
        list.push({ index: neighbourIndex, weight });
        degree[index] = (degree[index] ?? 0) + weight;
      }
      // Larger first, then path (files are path-sorted, so index order is path order).
      list.sort(
        (a, b) =>
          b.weight - a.weight || (sizes[b.index] ?? 0) - (sizes[a.index] ?? 0) || a.index - b.index,
      );
    }
    neighbours[index] = list;
  }

  const visited = new Uint8Array(count);
  const cursor = new Int32Array(count);
  const order: LayoutFileInput[] = [];
  const visit = (index: number) => {
    visited[index] = 1;
    const file = files[index];
    if (file) order.push(file);
  };

  const starts: number[] = [];
  const isolated: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if ((degree[index] ?? 0) > 0) starts.push(index);
    else isolated.push(index);
  }
  starts.sort((a, b) => (degree[b] ?? 0) - (degree[a] ?? 0) || a - b);

  const stack: number[] = [];
  for (const start of starts) {
    if (visited[start]) continue;
    visit(start);
    stack.push(start);
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      if (current === undefined) break;
      const list = neighbours[current] ?? [];
      let next = -1;
      while ((cursor[current] ?? 0) < list.length) {
        const candidate = list[cursor[current] ?? 0];
        cursor[current] = (cursor[current] ?? 0) + 1;
        if (candidate && !visited[candidate.index]) {
          next = candidate.index;
          break;
        }
      }
      if (next === -1) {
        stack.pop();
        continue;
      }
      visit(next);
      stack.push(next);
    }
  }

  isolated.sort((a, b) => (sizes[b] ?? 0) - (sizes[a] ?? 0) || a - b);
  for (const index of isolated) visit(index);
  return order;
}
