import { describe, expect, it } from "vitest";
import { encodeEvent, type AnalysisEvent } from "@/analysis/protocol";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { readNdjson, type MalformedLineInfo } from "./stream";
import { collect, createChunkedResponse, createControlledResponse } from "./test-helpers";

const stage = (overrides: Partial<Extract<AnalysisEvent, { type: "stage" }>> = {}): AnalysisEvent => ({
  type: "stage",
  stage: "connect",
  status: "done",
  message: "Repository found",
  ...overrides,
});

/** Splits a string into chunks of `size` characters. */
function chunk(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

describe("readNdjson", () => {
  it("yields every event of a well-formed stream and summarizes it", async () => {
    const body = [stage(), stage({ stage: "tree", message: "3,281 files" }), { type: "heartbeat" } as const]
      .map(encodeEvent)
      .join("");
    const { items, result } = await collect(readNdjson(createChunkedResponse([body])));
    expect(items).toEqual([stage(), stage({ stage: "tree", message: "3,281 files" }), { type: "heartbeat" }]);
    expect(result).toEqual({ events: 3, malformedLines: 0 });
  });

  it("reassembles lines split across arbitrary chunk boundaries", async () => {
    const events: AnalysisEvent[] = [
      stage({ stage: "parse", status: "progress", progress: 0.71, message: "1,065 of 1,500 files" }),
      { type: "complete", graph: mockRepositoryGraph },
    ];
    const body = events.map(encodeEvent).join("");
    for (const size of [1, 3, 7, 64, 4096]) {
      const { items, result } = await collect(readNdjson(createChunkedResponse(chunk(body, size))));
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual(events[0]);
      expect(items[1]?.type).toBe("complete");
      expect(result.malformedLines).toBe(0);
    }
  });

  it("decodes multi-byte UTF-8 characters split between network chunks", async () => {
    const bytes = new TextEncoder().encode(encodeEvent(stage({ message: "Données · 日本語 · 🚀" })));
    // Split inside the 4-byte emoji and inside a 3-byte CJK character.
    const emojiStart = bytes.findIndex((byte) => byte === 0xf0);
    const cjkStart = bytes.findIndex((byte) => byte === 0xe6);
    const cuts = [cjkStart + 1, emojiStart + 2].sort((a, b) => a - b);
    const chunks = [bytes.slice(0, cuts[0]), bytes.slice(cuts[0], cuts[1]), bytes.slice(cuts[1])];
    const { items } = await collect(readNdjson(createChunkedResponse(chunks)));
    expect(items).toEqual([stage({ message: "Données · 日本語 · 🚀" })]);
  });

  it("accepts CRLF line endings, including a CR/LF pair split across chunks", async () => {
    const line = JSON.stringify(stage());
    const { items, result } = await collect(
      readNdjson(createChunkedResponse([`${line}\r`, `\n${line}\r\n`, `\r\n`])),
    );
    expect(items).toEqual([stage(), stage()]);
    expect(result.malformedLines).toBe(0);
  });

  it("ignores blank and whitespace-only lines", async () => {
    const body = `\n\n${JSON.stringify(stage())}\n   \n\t\n${JSON.stringify({ type: "heartbeat" })}\n\n`;
    const { items, result } = await collect(readNdjson(createChunkedResponse([body])));
    expect(items).toHaveLength(2);
    expect(result).toEqual({ events: 2, malformedLines: 0 });
  });

  it("parses a complete final line that has no trailing newline", async () => {
    const body = `${JSON.stringify(stage())}\n${JSON.stringify({ type: "error", error: { code: "NOT_FOUND" } })}`;
    const { items } = await collect(readNdjson(createChunkedResponse(chunk(body, 5))));
    expect(items.map((event) => event.type)).toEqual(["stage", "error"]);
  });

  it("counts a truncated final line as malformed", async () => {
    const body = `${JSON.stringify(stage())}\n{"type":"complete","graph":{"schema`;
    const malformed: MalformedLineInfo[] = [];
    const { items, result } = await collect(
      readNdjson(createChunkedResponse([body]), undefined, { onMalformedLine: (info) => malformed.push(info) }),
    );
    expect(items).toHaveLength(1);
    expect(result.malformedLines).toBe(1);
    expect(malformed).toEqual([{ lineNumber: 2, reason: "invalid JSON" }]);
  });

  it("skips malformed and invalid lines but keeps reading", async () => {
    const lines = [
      "not json at all",
      JSON.stringify(stage()),
      JSON.stringify({ type: "mystery" }),
      JSON.stringify({ stage: "connect", status: "done" }),
      JSON.stringify({ type: "stage", stage: "teleport", status: "done" }),
      JSON.stringify({ type: "stage", stage: "parse", status: "exploded" }),
      JSON.stringify({ type: "complete", graph: { schemaVersion: 99 } }),
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ type: "heartbeat" }),
    ];
    const malformed: MalformedLineInfo[] = [];
    const { items, result } = await collect(
      readNdjson(createChunkedResponse([`${lines.join("\n")}\n`]), undefined, {
        onMalformedLine: (info) => malformed.push(info),
      }),
    );
    expect(items.map((event) => event.type)).toEqual(["stage", "heartbeat"]);
    expect(result).toEqual({ events: 2, malformedLines: 7 });
    expect(malformed.map((info) => info.lineNumber)).toEqual([1, 3, 4, 5, 6, 7, 8]);
    expect(malformed.map((info) => info.reason)).toEqual([
      "invalid JSON",
      "unknown event type",
      "missing event type",
      "unknown stage",
      "unknown stage status",
      "invalid graph",
      "not an object",
    ]);
  });

  it("clamps progress and truncates overly long messages", async () => {
    const body = `${JSON.stringify({ type: "stage", stage: "parse", status: "progress", progress: 7, message: "x".repeat(500) })}\n`;
    const { items } = await collect(readNdjson(createChunkedResponse([body])));
    const event = items[0];
    expect(event?.type).toBe("stage");
    if (event?.type !== "stage") return;
    expect(event.progress).toBe(1);
    expect(event.message?.length).toBeLessThanOrEqual(160);
    expect(event.message?.endsWith("…")).toBe(true);
  });

  it("discards lines longer than the limit without buffering them, then recovers", async () => {
    const long = JSON.stringify({ type: "stage", stage: "connect", status: "done", message: "y".repeat(400) });
    const malformed: MalformedLineInfo[] = [];
    const { items, result } = await collect(
      readNdjson(createChunkedResponse(chunk(`${long}\n${JSON.stringify(stage())}\n`, 50)), undefined, {
        maxLineLength: 200,
        onMalformedLine: (info) => malformed.push(info),
      }),
    );
    expect(items).toEqual([stage()]);
    expect(result.malformedLines).toBe(1);
    expect(malformed).toEqual([{ lineNumber: 1, reason: "line too long" }]);
  });

  it("returns immediately for a response without a body", async () => {
    const { items, result } = await collect(readNdjson(new Response(null, { status: 200 })));
    expect(items).toEqual([]);
    expect(result).toEqual({ events: 0, malformedLines: 0 });
  });

  it("stops with the abort reason when the signal aborts mid-stream", async () => {
    const control = createControlledResponse();
    const controller = new AbortController();
    const iterator = readNdjson(control.response, controller.signal);
    control.pushEvent(stage());
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: stage() });
    const pending = iterator.next();
    controller.abort(new DOMException("Navigated away", "AbortError"));
    control.push("\n");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws immediately for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readNdjson(createChunkedResponse(["{}\n"]), controller.signal).next()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("propagates network errors raised while reading", async () => {
    const control = createControlledResponse();
    const iterator = readNdjson(control.response);
    control.pushEvent(stage());
    await iterator.next();
    const pending = iterator.next();
    control.fail(new TypeError("network connection lost"));
    await expect(pending).rejects.toThrow("network connection lost");
  });

  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeEvent(stage())));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readNdjson(new Response(stream))) {
      expect(event.type).toBe("stage");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
