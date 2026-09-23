import type { GraphIndex } from "@/graph/model/graph-index";
import type { DependencyEdge, RepositoryGraph } from "@/graph/model/types";

/**
 * Connectivity ranking: which files are the hubs of the dependency graph.
 */

export interface FileConnectivity {
  fileId: string;
  /** Distinct files importing this file. */
  importedBy: number;
  /** Distinct files this file imports. */
  imports: number;
  /** importedBy + imports. */
  degree: number;
  /** Sum of the weights (import statements) of all incident edges. */
  weight: number;
}

function isGraphIndex(source: GraphIndex | RepositoryGraph): source is GraphIndex {
  return "filesById" in source && "dependenciesBySource" in source;
}

const compare = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Ranks files by dependency connectivity: most distinct neighbours first, then
 * most dependants, then most import statements, then id. Files without any
 * dependency edge are not returned.
 */
export function rankFilesByConnectivity(
  source: GraphIndex | RepositoryGraph,
  limit = 10,
): FileConnectivity[] {
  const edges: readonly DependencyEdge[] = isGraphIndex(source)
    ? source.graph.dependencies
    : source.dependencies;
  const dependants = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  const weights = new Map<string, number>();
  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  };

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    add(dependencies, edge.source, edge.target);
    add(dependants, edge.target, edge.source);
    weights.set(edge.source, (weights.get(edge.source) ?? 0) + edge.weight);
    weights.set(edge.target, (weights.get(edge.target) ?? 0) + edge.weight);
  }

  const ranked: FileConnectivity[] = [];
  for (const fileId of new Set([...dependants.keys(), ...dependencies.keys()])) {
    const importedBy = dependants.get(fileId)?.size ?? 0;
    const imports = dependencies.get(fileId)?.size ?? 0;
    ranked.push({
      fileId,
      importedBy,
      imports,
      degree: importedBy + imports,
      weight: weights.get(fileId) ?? 0,
    });
  }
  return ranked
    .sort(
      (a, b) =>
        b.degree - a.degree ||
        b.importedBy - a.importedBy ||
        b.weight - a.weight ||
        compare(a.fileId, b.fileId),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}
