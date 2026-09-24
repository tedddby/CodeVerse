/**
 * Test helpers for explorer components: seed the global explorer store with
 * fixture graphs. Used only by tests; never imported by application code.
 */
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { GraphIndex } from "@/graph/model/graph-index";
import { directoryId, fileId, symbolId } from "@/graph/model/ids";
import type { NodeRef, RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";

/** Clears repository state and environment flags so tests don't leak into each other. */
export function resetExplorerStore(): void {
  const store = useExplorerStore.getState();
  store.reset();
  useExplorerStore.setState({
    navigationMode: "orbit",
    reducedMotion: false,
    webglAvailable: null,
  });
}

/** Resets the store and loads a graph (the mock repository by default). Returns its index. */
export function loadMockGraph(graph: RepositoryGraph = mockRepositoryGraph): GraphIndex {
  resetExplorerStore();
  useExplorerStore.getState().loadGraph(graph);
  const index = useExplorerStore.getState().index;
  if (!index) throw new Error("loadMockGraph: the store did not build a graph index");
  return index;
}

export function fileRef(path: string): NodeRef {
  return { kind: "file", id: fileId(path) };
}

export function directoryRef(path: string): NodeRef {
  return { kind: "directory", id: directoryId(path) };
}

export function symbolRef(filePath: string, name: string, startLine: number): NodeRef {
  return { kind: "symbol", id: symbolId(filePath, name, startLine) };
}

/** Selects a node without issuing camera commands. */
export function selectNode(ref: NodeRef | null): void {
  useExplorerStore.getState().select(ref);
}
