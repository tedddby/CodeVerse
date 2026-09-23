import type { DependencyEdge, DependencyKind, RepositoryGraph } from "@/graph/model/types";

/**
 * Import-cycle detection over file dependency edges.
 *
 * A "cycle" here is a strongly connected component with more than one file:
 * every file in it can reach every other file through imports. One component
 * may contain several elementary cycles; reporting components keeps the result
 * small and stable, which is what analytics and "untangle this" UIs need.
 */

export interface ImportCycle {
  /** Files in the component, sorted. */
  fileIds: string[];
  /** Ids of the dependency edges between files of the component, sorted. */
  edgeIds: string[];
}

export interface FindImportCyclesOptions {
  /** Maximum number of cycles returned (largest first). Default 50. */
  limit?: number;
  /** Only follow edges of these kinds (e.g. exclude "type-import" for runtime cycles). Default: all. */
  kinds?: readonly DependencyKind[];
}

const compare = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

/** Tarjan's algorithm, iterative so deep import chains cannot overflow the call stack. */
function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    index.set(root, counter);
    lowLink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next] ?? "";
        frame.next += 1;
        if (!index.has(neighbour)) {
          index.set(neighbour, counter);
          lowLink.set(neighbour, counter);
          counter += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          work.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowLink.set(
            frame.node,
            Math.min(lowLink.get(frame.node) ?? 0, index.get(neighbour) ?? 0),
          );
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node) ?? 0, lowLink.get(frame.node) ?? 0),
        );
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

/** Finds import cycles (strongly connected components with more than one file), largest first. */
export function findImportCycles(
  graph: Pick<RepositoryGraph, "dependencies">,
  options: FindImportCyclesOptions = {},
): ImportCycle[] {
  const limit = Math.max(0, Math.floor(options.limit ?? 50));
  const kinds = options.kinds ? new Set<string>(options.kinds) : null;
  const edges: DependencyEdge[] = graph.dependencies.filter(
    (edge) => edge.source !== edge.target && (!kinds || kinds.has(edge.kind)),
  );

  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.source);
    nodes.add(edge.target);
    const targets = adjacency.get(edge.source);
    if (targets) targets.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }
  for (const [source, targets] of adjacency)
    adjacency.set(source, [...new Set(targets)].sort(compare));

  const componentOf = new Map<string, number>();
  const cycles: ImportCycle[] = [];
  for (const component of stronglyConnectedComponents([...nodes].sort(compare), adjacency)) {
    if (component.length < 2) continue;
    const position = cycles.length;
    for (const member of component) componentOf.set(member, position);
    cycles.push({ fileIds: component.sort(compare), edgeIds: [] });
  }
  for (const edge of edges) {
    const source = componentOf.get(edge.source);
    if (source !== undefined && source === componentOf.get(edge.target))
      cycles[source]?.edgeIds.push(edge.id);
  }
  for (const cycle of cycles) cycle.edgeIds.sort(compare);

  return cycles
    .sort(
      (a, b) =>
        b.fileIds.length - a.fileIds.length || compare(a.fileIds[0] ?? "", b.fileIds[0] ?? ""),
    )
    .slice(0, limit);
}
