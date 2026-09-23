import { describe, expect, it } from "vitest";
import { streamResponse } from "./__fixtures__/fake-fetch";
import {
  BINARY_SNIFF_BYTES,
  classifyContent,
  decodeUtf8,
  looksBinary,
  readBoundedBody,
} from "./content";

const encoder = new TextEncoder();

describe("looksBinary", () => {
  it("treats text (including tabs, form feeds and CRLF) as text", () => {
    expect(looksBinary(encoder.encode("const a = 1;\r\n\tlet b = 2;\f\n"))).toBe(false);
    expect(looksBinary(new Uint8Array(0))).toBe(false);
    expect(looksBinary(encoder.encode("héllo wörld — ünïcode 🚀"))).toBe(false);
  });

  it("detects NUL bytes", () => {
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x21]))).toBe(true);
  });

  it("detects content dominated by control bytes", () => {
    const bytes = new Uint8Array(100).fill(0x41);
    bytes.fill(0x01, 0, 31);
    expect(looksBinary(bytes)).toBe(true);
    const fewer = new Uint8Array(100).fill(0x41);
    fewer.fill(0x1b, 0, 29);
    expect(looksBinary(fewer)).toBe(false);
  });

  it("only inspects the first 8 KB", () => {
    const bytes = new Uint8Array(BINARY_SNIFF_BYTES + 10).fill(0x61);
    bytes[BINARY_SNIFF_BYTES + 5] = 0;
    expect(looksBinary(bytes)).toBe(false);
  });
});

describe("decodeUtf8 / classifyContent", () => {
  it("strips a UTF-8 byte order mark but counts its bytes", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("hello")]);
    expect(decodeUtf8(bytes)).toBe("hello");
    expect(classifyContent(bytes)).toEqual({ kind: "text", content: "hello", size: 8 });
  });

  it("decodes invalid UTF-8 leniently", () => {
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe(`a${String.fromCharCode(0xfffd)}b`);
  });

  it("classifies binary content with its size", () => {
    expect(classifyContent(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]))).toEqual({
      kind: "binary",
      size: 6,
    });
  });
});

describe("readBoundedBody", () => {
  it("reads all chunks when within budget", async () => {
    const { response } = streamResponse([encoder.encode("abc"), encoder.encode("def")]);
    const result = await readBoundedBody(response, 6);
    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(decodeUtf8(result.bytes)).toBe("abcdef");
  });

  it("cancels the stream as soon as the budget is exceeded", async () => {
    const chunk = new Uint8Array(1024).fill(0x61);
    const { response, state } = streamResponse([chunk, chunk, chunk, chunk, chunk]);
    const result = await readBoundedBody(response, 1500);
    expect(result).toEqual({ kind: "overflow", bytesRead: 2048 });
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(5);
  });

  it("handles responses without a body", async () => {
    const result = await readBoundedBody(new Response(null, { status: 200 }), 10);
    expect(result).toEqual({ kind: "complete", bytes: new Uint8Array(0) });
  });

  it("stops reading when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { response } = streamResponse([encoder.encode("abc")]);
    await expect(readBoundedBody(response, 10, controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
  });
});
