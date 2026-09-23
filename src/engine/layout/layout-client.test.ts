import { describe, expect, it, vi } from "vitest";
import { createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import {
  LayoutClient,
  type LayoutWorkerCallbacks,
  type LayoutWorkerPort,
  type TaskScheduler,
} from "./layout-client";
import { handleLayoutWorkerMessage, type LayoutComputeRequest } from "./worker-protocol";

/** A controllable in-memory worker: requests queue up until `flush()` answers them. */
class FakeWorker implements LayoutWorkerPort {
  readonly requests: LayoutComputeRequest[] = [];
  terminated = false;
  constructor(readonly callbacks: LayoutWorkerCallbacks) {}

  post(message: LayoutComputeRequest): void {
    if (this.terminated) throw new Error("posted to a terminated worker");
    this.requests.push(structuredClone(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers queued requests (oldest first) using the real protocol handler. */
  flush(): void {
    while (this.requests.length > 0) {
      const request = this.requests.shift();
      const response = handleLayoutWorkerMessage(request);
      if (response) this.callbacks.onMessage(structuredClone(response));
    }
  }
}

function setup(options: { worker?: boolean } = {}) {
  const workers: FakeWorker[] = [];
  const tasks: Array<() => void> = [];
  const schedule: TaskScheduler = (task) => {
    tasks.push(task);
    return () => {
      const position = tasks.indexOf(task);
      if (position >= 0) tasks.splice(position, 1);
    };
  };
  const compute = vi.fn((graph: Parameters<typeof handleLayoutWorkerMessage>[0]) => {
    const response = handleLayoutWorkerMessage({ type: "compute", requestId: 0, graph });
    if (response?.type !== "result") throw new Error("layout failed");
    return response.layout;
  });
  const client = new LayoutClient({
    createWorker:
      options.worker === false
        ? () => null
        : (callbacks) => {
            const worker = new FakeWorker(callbacks);
            workers.push(worker);
            return worker;
          },
    schedule,
    compute,
  });
  const runTasks = () => {
    while (tasks.length > 0) tasks.shift()?.();
  };
  return { client, workers, tasks, runTasks, compute };
}

/** Fresh graph objects so the per-graph memo does not leak between tests. */
const freshGraph = (): RepositoryGraph => structuredClone(mockRepositoryGraph);

describe("LayoutClient", () => {
  it("computes in the worker and posts a compact graph", async () => {
    const { client, workers, compute } = setup();
    const graph = freshGraph();
    const pending = client.compute(graph);
    const worker = workers[0];
    if (!worker) throw new Error("no worker created");
    const posted = worker.requests[0]?.graph as unknown as Record<string, unknown>;
    expect(posted.symbols).toBeUndefined();
    expect(posted.commits).toBeUndefined();
    worker.flush();
    const outcome = await pending;
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.source).toBe("worker");
      expect(outcome.layout.key).toBe(`${graph.repository.id}@${graph.repository.commitSha}`);
    }
    expect(compute).not.toHaveBeenCalled();
  });

  it("reuses one worker and marks superseded requests as stale", async () => {
    const { client, workers } = setup();
    const first = client.compute(freshGraph());
    const secondGraph = createSyntheticGraph({ fileCount: 50, seed: 3 });
    const second = client.compute(secondGraph);
    expect(await first).toEqual({ status: "stale" });
    expect(workers).toHaveLength(1);
    workers[0]?.flush();
    const outcome = await second;
    expect(outcome.status === "done" && outcome.layout.key.includes("repo-50")).toBe(true);
  });

  it("ignores late results for old request ids", async () => {
    const { client, workers } = setup();
    const graphA = freshGraph();
    void client.compute(graphA);
    const worker = workers[0];
    if (!worker) throw new Error("no worker created");
    const oldRequest = worker.requests.shift();
    const current = client.compute(createSyntheticGraph({ fileCount: 30, seed: 9 }));
    // The old request finishes after the new one was issued: its result must be dropped.
    const oldResponse = handleLayoutWorkerMessage(oldRequest);
    worker.callbacks.onMessage(oldResponse);
    worker.flush();
    const outcome = await current;
    expect(outcome.status === "done" && outcome.layout.key.includes("repo-30")).toBe(true);
  });

  it("falls back to the main thread, deferred, when workers are unavailable", async () => {
    const { client, tasks, runTasks, compute } = setup({ worker: false });
    const pending = client.compute(freshGraph());
    expect(compute).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    runTasks();
    const outcome = await pending;
    expect(outcome.status === "done" && outcome.source).toBe("main-thread");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("falls back to the main thread when the worker crashes, and stops using it", async () => {
    const { client, workers, runTasks } = setup();
    const pending = client.compute(freshGraph());
    const worker = workers[0];
    worker?.callbacks.onError("worker script failed to load");
    expect(worker?.terminated).toBe(true);
    runTasks();
    expect((await pending).status).toBe("done");
    const next = client.compute(freshGraph());
    expect(workers).toHaveLength(1);
    runTasks();
    expect(await next).toMatchObject({ status: "done", source: "main-thread" });
  });

  it("retries on the main thread when the worker reports an error", async () => {
    const { client, workers, runTasks, compute } = setup();
    const pending = client.compute(freshGraph());
    const request = workers[0]?.requests.shift();
    workers[0]?.callbacks.onMessage({ type: "error", requestId: request?.requestId, message: "x" });
    runTasks();
    expect(await pending).toMatchObject({ status: "done", source: "main-thread" });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("reports an error when the main-thread computation throws", async () => {
    const client = new LayoutClient({
      createWorker: () => null,
      schedule: (task) => {
        task();
        return () => undefined;
      },
      compute: () => {
        throw new Error("out of memory");
      },
    });
    const outcome = await client.compute(freshGraph());
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.message).toContain("out of memory");
  });

  it("falls back when posting to the worker throws (e.g. a clone error)", async () => {
    const { client, workers, runTasks } = setup();
    const pending = client.compute(freshGraph());
    const worker = workers[0];
    if (!worker) throw new Error("no worker created");
    worker.terminate();
    const second = client.compute(freshGraph());
    expect(await pending).toEqual({ status: "stale" });
    runTasks();
    expect(await second).toMatchObject({ status: "done", source: "main-thread" });
  });

  it("serves an unchanged graph from the memo", async () => {
    const { client, workers } = setup();
    const graph = freshGraph();
    const pending = client.compute(graph);
    workers[0]?.flush();
    const first = await pending;
    const again = await client.compute(graph);
    expect(again.status === "done" && again.source).toBe("cache");
    expect(
      again.status === "done" && first.status === "done" && again.layout === first.layout,
    ).toBe(true);
  });

  it("settles pending work as stale and terminates the worker on dispose", async () => {
    const { client, workers, tasks } = setup();
    const pending = client.compute(freshGraph());
    client.dispose();
    expect(await pending).toEqual({ status: "stale" });
    expect(workers[0]?.terminated).toBe(true);
    expect(await client.compute(freshGraph())).toEqual({ status: "stale" });
    expect(tasks).toHaveLength(0);
  });
});
