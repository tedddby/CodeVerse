/**
 * Test helpers for the analysis client: build streaming NDJSON `Response`s
 * with precise control over chunk boundaries. Used only by tests.
 */
import { encodeEvent, type AnalysisEvent } from "@/analysis/protocol";

const encoder = new TextEncoder();

export interface StreamControl {
  response: Response;
  /** Pushes raw text (encoded as UTF-8) as one network chunk. */
  push: (text: string) => void;
  /** Pushes raw bytes as one network chunk. */
  pushBytes: (bytes: Uint8Array) => void;
  pushEvent: (event: AnalysisEvent) => void;
  close: () => void;
  /** Makes the next read fail like a dropped connection. */
  fail: (error?: unknown) => void;
}

/** A response whose body is fed manually, chunk by chunk. */
export function createControlledResponse(init: ResponseInit = {}): StreamControl {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    ...init,
  });
  return {
    response,
    push: (text) => controller.enqueue(encoder.encode(text)),
    pushBytes: (bytes) => controller.enqueue(bytes),
    pushEvent: (event) => controller.enqueue(encoder.encode(encodeEvent(event))),
    close: () => controller.close(),
    fail: (error = new TypeError("network error")) => controller.error(error),
  };
}

/** A response whose body is the given chunks (already split as desired), then closes. */
export function createChunkedResponse(chunks: Array<string | Uint8Array>, init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    ...init,
  });
}

/** Collects every event (and the summary) from an async generator. */
export async function collect<T, R>(generator: AsyncGenerator<T, R, undefined>): Promise<{ items: T[]; result: R }> {
  const items: T[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { items, result: next.value };
    items.push(next.value);
  }
}
