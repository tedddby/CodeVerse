/**
 * Layout worker: computes `WorldLayout`s off the main thread so the UI stays
 * responsive while a large repository is being laid out.
 *
 * Spawned by `useLayoutEngine` with
 *   new Worker(new URL("../../workers/layout.worker.ts", import.meta.url), { type: "module" })
 * Protocol and message handling live in `@/engine/layout/worker-protocol`.
 */
import {
  handleLayoutWorkerMessage,
  type LayoutWorkerResponse,
} from "@/engine/layout/worker-protocol";

/**
 * The subset of `DedicatedWorkerGlobalScope` used here. The project compiles
 * against the DOM lib (not the WebWorker lib), so the scope is typed locally.
 */
interface LayoutWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: LayoutWorkerResponse): void;
}

const scope = self as unknown as LayoutWorkerScope;

scope.addEventListener("message", (event) => {
  const response = handleLayoutWorkerMessage(event.data);
  if (response) scope.postMessage(response);
});
