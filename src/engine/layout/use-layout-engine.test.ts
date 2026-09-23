// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import type * as ComputeLayoutModule from "./compute-layout";
import { computeWorldLayout } from "./compute-layout";
import { useLayoutEngine } from "./use-layout-engine";
import { handleLayoutWorkerMessage } from "./worker-protocol";

vi.mock("./compute-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof ComputeLayoutModule>();
  return { ...actual, computeWorldLayout: vi.fn(actual.computeWorldLayout) };
});

/** Minimal stand-in for a DOM module Worker running the real protocol handler asynchronously. */
class FakeDomWorker {
  static instances: FakeDomWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;
  readonly posted: unknown[] = [];

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeDomWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    const cloned = structuredClone(message);
    this.posted.push(cloned);
    setTimeout(() => {
      if (this.terminated) return;
      const response = handleLayoutWorkerMessage(cloned);
      if (response) this.onmessage?.(new MessageEvent("message", { data: response }));
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Fresh graph objects so results memoized for another test are not reused. */
const freshMock = (): RepositoryGraph => structuredClone(mockRepositoryGraph);

beforeEach(() => {
  FakeDomWorker.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  useExplorerStore.getState().reset();
});

describe("useLayoutEngine", () => {
  it("computes the layout in a module worker and publishes it to the store", async () => {
    vi.stubGlobal("Worker", FakeDomWorker);
    const graph = freshMock();
    useExplorerStore.getState().loadGraph(graph);
    const { result } = renderHook(() => useLayoutEngine());
    expect(result.current).toEqual({ computing: true, error: null });

    await waitFor(() => expect(result.current.computing).toBe(false));
    expect(result.current.error).toBeNull();
    const layout = useExplorerStore.getState().layout;
    expect(layout?.key).toBe(`${graph.repository.id}@${graph.repository.commitSha}`);
    expect(layout?.buildings).toHaveLength(graph.files.length);

    const worker = FakeDomWorker.instances[0];
    expect(FakeDomWorker.instances).toHaveLength(1);
    expect(worker?.url.pathname.endsWith("/workers/layout.worker.ts")).toBe(true);
    expect(worker?.options.type).toBe("module");
  });

  it("falls back to the main thread when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    const graph = freshMock();
    useExplorerStore.getState().loadGraph(graph);
    const { result } = renderHook(() => useLayoutEngine());
    // The fallback defers to the next frame and computes synchronously; allow for a loaded CI machine.
    await waitFor(() => expect(useExplorerStore.getState().layout).not.toBeNull(), { timeout: 10_000 });
    expect(result.current.computing).toBe(false);
    expect(useExplorerStore.getState().layout?.buildings).toHaveLength(graph.files.length);
  });

  it("reuses the worker across graphs and only publishes the latest graph's layout", async () => {
    vi.stubGlobal("Worker", FakeDomWorker);
    const first = freshMock();
    const second = createSyntheticGraph({ fileCount: 120, seed: 12 });
    useExplorerStore.getState().loadGraph(first);
    const { result } = renderHook(() => useLayoutEngine());
    // Switch graphs before the first layout arrives.
    act(() => useExplorerStore.getState().loadGraph(second));

    await waitFor(() => expect(result.current.computing).toBe(false));
    // Give any late result for the first graph a chance to (wrongly) land.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(useExplorerStore.getState().layout?.key).toBe(
      `${second.repository.id}@${second.repository.commitSha}`,
    );
    expect(FakeDomWorker.instances).toHaveLength(1);
    expect(FakeDomWorker.instances[0]?.posted).toHaveLength(2);
  });

  it("terminates the worker on unmount", async () => {
    vi.stubGlobal("Worker", FakeDomWorker);
    useExplorerStore.getState().loadGraph(freshMock());
    const { result, unmount } = renderHook(() => useLayoutEngine());
    await waitFor(() => expect(result.current.computing).toBe(false));
    unmount();
    expect(FakeDomWorker.instances[0]?.terminated).toBe(true);
  });

  it("reports an error when the layout cannot be computed anywhere", async () => {
    vi.stubGlobal("Worker", undefined);
    vi.mocked(computeWorldLayout).mockImplementationOnce(() => {
      throw new Error("corrupt graph");
    });
    useExplorerStore.getState().loadGraph(freshMock());
    const { result } = renderHook(() => useLayoutEngine());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.computing).toBe(false);
    expect(result.current.error).toContain("corrupt graph");
    expect(useExplorerStore.getState().layout).toBeNull();
  });

  it("is idle without a graph", () => {
    const { result } = renderHook(() => useLayoutEngine());
    expect(result.current).toEqual({ computing: false, error: null });
  });
});
