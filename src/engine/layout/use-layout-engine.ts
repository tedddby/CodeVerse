"use client";

import { useEffect, useRef, useState } from "react";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { LayoutClient, type LayoutWorkerCallbacks, type LayoutWorkerPort } from "./layout-client";

/**
 * Keeps `useExplorerStore().layout` in sync with `useExplorerStore().graph`.
 *
 * Mount exactly once per page (the explorer shell, or the landing demo). On
 * every graph change the layout is computed in a Web Worker (falling back to
 * the main thread when workers are unavailable or fail); results for a graph
 * that is no longer current are dropped. The worker is created lazily, reused
 * across graphs and terminated on unmount.
 */
export interface LayoutEngineStatus {
  /** True while the current graph has no finished layout computation. */
  computing: boolean;
  /** User-facing message when the current graph could not be laid out. */
  error: string | null;
}

/** Spawns the layout worker, or returns null when the environment has no module workers. */
export function createLayoutWorkerPort(callbacks: LayoutWorkerCallbacks): LayoutWorkerPort | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("../../workers/layout.worker.ts", import.meta.url), {
    type: "module",
    name: "codeverse-layout",
  });
  worker.onmessage = (event: MessageEvent<unknown>) => callbacks.onMessage(event.data);
  worker.onerror = (event: ErrorEvent) => {
    // Handled by falling back to the main thread; keep it out of the console as an uncaught error.
    event.preventDefault();
    callbacks.onError(event.message || "Layout worker failed");
  };
  worker.onmessageerror = () => callbacks.onError("Layout worker response could not be read");
  return {
    post: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
}

interface SettledState {
  graph: RepositoryGraph | null;
  error: string | null;
}

export function useLayoutEngine(): LayoutEngineStatus {
  const graph = useExplorerStore((state) => state.graph);
  const clientRef = useRef<LayoutClient | null>(null);
  const [settled, setSettled] = useState<SettledState>({ graph: null, error: null });

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!graph) return;
    let active = true;
    clientRef.current ??= new LayoutClient({ createWorker: createLayoutWorkerPort });
    clientRef.current.compute(graph).then(
      (outcome) => {
        if (!active || outcome.status === "stale") return;
        if (outcome.status === "done") {
          const store = useExplorerStore.getState();
          // Only publish when the graph is still the one in the store.
          if (store.graph === graph) store.setLayout(outcome.layout);
          setSettled({ graph, error: null });
        } else {
          setSettled({ graph, error: outcome.message });
        }
      },
      (error: unknown) => {
        if (!active) return;
        const reason = error instanceof Error && error.message ? error.message : "unknown error";
        setSettled({ graph, error: `Could not lay out this repository: ${reason}` });
      },
    );
    return () => {
      active = false;
    };
  }, [graph]);

  const isSettled = graph !== null && settled.graph === graph;
  return {
    computing: graph !== null && !isSettled,
    error: isSettled ? settled.error : null,
  };
}
