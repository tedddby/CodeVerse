import { describe, expect, it } from "vitest";
import { ERROR_COPY, NDJSON_CONTENT_TYPE, type AnalysisEvent } from "./protocol";
import { createAnalysisStreamResponse, ndjsonErrorResponse } from "./ndjson-stream";

async function lines(response: Response): Promise<AnalysisEvent[]> {
  const text = await response.text();
  expect(text.endsWith("\n")).toBe(true);
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as AnalysisEvent);
}

const INTERNAL = { type: "error", error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL } };

describe("createAnalysisStreamResponse", () => {
  it("frames events as NDJSON with streaming headers", async () => {
    const response = createAnalysisStreamResponse(async (emit) => {
      emit({ type: "stage", stage: "connect", status: "start" });
      emit({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } });
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect((await lines(response)).map((event) => event.type)).toEqual(["stage", "error"]);
  });

  it("appends an INTERNAL error when the producer ends without a terminal event", async () => {
    const response = createAnalysisStreamResponse(async (emit) => {
      emit({ type: "stage", stage: "connect", status: "start" });
    });
    expect((await lines(response)).at(-1)).toEqual(INTERNAL);
  });

  it("reports producer exceptions as INTERNAL errors", async () => {
    const failures: unknown[] = [];
    const response = createAnalysisStreamResponse(
      async () => {
        throw new Error("boom");
      },
      { onError: (error) => failures.push(error) },
    );
    expect(await lines(response)).toEqual([INTERNAL]);
    expect(failures).toHaveLength(1);
  });

  it("drops everything after the first terminal event", async () => {
    const response = createAnalysisStreamResponse(async (emit) => {
      emit({ type: "error", error: { code: "TIMEOUT", ...ERROR_COPY.TIMEOUT } });
      emit({ type: "stage", stage: "tree", status: "start" });
      emit({ type: "error", error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL } });
    });
    expect(await lines(response)).toEqual([
      { type: "error", error: { code: "TIMEOUT", ...ERROR_COPY.TIMEOUT } },
    ]);
  });

  it("replaces an unencodable final graph with an INTERNAL error", async () => {
    const response = createAnalysisStreamResponse(async (emit) => {
      const graph = { big: 1n } as unknown as Extract<AnalysisEvent, { type: "complete" }>["graph"];
      emit({ type: "complete", graph });
    });
    expect(await lines(response)).toEqual([INTERNAL]);
  });

  it("writes heartbeats while the producer is busy", async () => {
    const response = createAnalysisStreamResponse(
      async (emit) => {
        // 25 heartbeat periods: at least 2 must land even when a loaded
        // machine delays and coalesces timers.
        await new Promise((resolve) => setTimeout(resolve, 250));
        emit({ type: "error", error: { code: "TIMEOUT", ...ERROR_COPY.TIMEOUT } });
      },
      { heartbeatMs: 10 },
    );
    const events = await lines(response);
    expect(events.filter((event) => event.type === "heartbeat").length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("aborts the producer when the request signal aborts", async () => {
    const controller = new AbortController();
    let producerSignal: AbortSignal | undefined;
    const settled = new Promise<void>((resolve) => {
      const response = createAnalysisStreamResponse(
        async (emit, signal) => {
          producerSignal = signal;
          emit({ type: "stage", stage: "connect", status: "start" });
          await new Promise((done) => signal.addEventListener("abort", done, { once: true }));
          emit({ type: "stage", stage: "tree", status: "start" });
          resolve();
        },
        { signal: controller.signal, heartbeatMs: 5 },
      );
      void response.body?.getReader().read();
    });
    controller.abort();
    await settled;
    expect(producerSignal?.aborted).toBe(true);
  });

  it("aborts the producer when the consumer cancels the body", async () => {
    let producerSignal: AbortSignal | undefined;
    const response = createAnalysisStreamResponse(async (_emit, signal) => {
      producerSignal = signal;
      await new Promise((done) => signal.addEventListener("abort", done, { once: true }));
    });
    const reader = response.body?.getReader();
    await reader?.cancel();
    expect(producerSignal?.aborted).toBe(true);
  });
});

describe("ndjsonErrorResponse", () => {
  it("returns a single error event with the given status and headers", async () => {
    const response = ndjsonErrorResponse(
      429,
      { code: "CLIENT_RATE_LIMITED", ...ERROR_COPY.CLIENT_RATE_LIMITED },
      { "Retry-After": "30" },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    expect(await lines(response)).toEqual([
      { type: "error", error: { code: "CLIENT_RATE_LIMITED", ...ERROR_COPY.CLIENT_RATE_LIMITED } },
    ]);
  });
});
