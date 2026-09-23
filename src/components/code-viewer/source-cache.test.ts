import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchSourceFile,
  isSourceErrorResponse,
  isSourceFileResponse,
  LruCache,
  SourceRequestAbortedError,
  sourceFileCache,
} from "./source-cache";
import {
  maxVisualWidth,
  scrollTopForLine,
  splitSourceLines,
  visibleLineRange,
  visualWidth,
} from "./source-lines";
import { buildOutline, symbolAtLine } from "./symbol-outline";
import type { SymbolNode } from "@/graph/model/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FILE = {
  path: "src/a.ts",
  ref: "abc",
  size: 12,
  content: "const a = 1;",
  language: "typescript",
  lines: 1,
};

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "a" is now most recent
    cache.set("c", 3);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(2);
  });

  it("peek does not change recency", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.peek("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
  });
});

describe("response guards", () => {
  it("accepts well-formed bodies only", () => {
    expect(isSourceFileResponse(FILE)).toBe(true);
    expect(isSourceFileResponse({ ...FILE, content: 3 })).toBe(false);
    expect(isSourceErrorResponse({ error: { code: "BINARY", title: "t", message: "m" } })).toBe(
      true,
    );
    expect(isSourceErrorResponse({ error: { code: "EVIL", title: "t", message: "m" } })).toBe(
      false,
    );
    expect(isSourceErrorResponse(null)).toBe(false);
  });
});

describe("fetchSourceFile", () => {
  beforeEach(() => sourceFileCache.clear());

  it("returns and caches successful responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse(FILE));
    const first = await fetchSourceFile(
      "/api/source/o/r?x=1",
      new AbortController().signal,
      fetcher,
    );
    const second = await fetchSourceFile(
      "/api/source/o/r?x=1",
      new AbortController().signal,
      fetcher,
    );
    expect(first).toEqual({ ok: true, file: FILE });
    expect(second).toEqual({ ok: true, file: FILE });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors with their title and message", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { code: "TOO_LARGE", title: "Too big.", message: "Over 1 MB." } }, 413),
    );
    const result = await fetchSourceFile("/x", new AbortController().signal, fetcher);
    expect(result).toEqual({
      ok: false,
      error: { code: "TOO_LARGE", title: "Too big.", message: "Over 1 MB.", retryable: false },
    });
  });

  it("maps HTTP statuses when the body is not an API error", async () => {
    const fetcher = vi.fn(async () => new Response("<html>oops</html>", { status: 429 }));
    const result = await fetchSourceFile("/x", new AbortController().signal, fetcher);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("rejects malformed success bodies", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ hello: "world" }));
    const result = await fetchSourceFile("/x", new AbortController().signal, fetcher);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RESPONSE");
    expect(sourceFileCache.size).toBe(0);
  });

  it("reports network failures as retryable", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await fetchSourceFile("/x", new AbortController().signal, fetcher);
    expect(result).toMatchObject({ ok: false, error: { code: "NETWORK", retryable: true } });
  });

  it("throws a dedicated error when aborted", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(fetchSourceFile("/x", controller.signal, fetcher)).rejects.toBeInstanceOf(
      SourceRequestAbortedError,
    );
  });
});

describe("source lines", () => {
  it("splits on any newline and ignores a single trailing newline", () => {
    expect(splitSourceLines("a\nb\r\nc\rd\n")).toEqual(["a", "b", "c", "d"]);
    expect(splitSourceLines("a\n\n")).toEqual(["a", ""]);
    expect(splitSourceLines("")).toEqual([]);
    expect(splitSourceLines("\n")).toEqual([""]);
  });

  it("expands tabs to tab stops when measuring", () => {
    expect(visualWidth("\tx")).toBe(5);
    expect(visualWidth("ab\tx")).toBe(5);
    expect(maxVisualWidth(["abc", "\t\tx", "a"])).toBe(9);
    expect(maxVisualWidth(["x".repeat(10_000)], 100)).toBe(100);
  });

  it("computes the virtual window with overscan and clamping", () => {
    expect(visibleLineRange(0, 200, 20, 1_000, 5)).toEqual({ start: 0, end: 15 });
    expect(visibleLineRange(2_000, 200, 20, 1_000, 5)).toEqual({ start: 95, end: 115 });
    expect(visibleLineRange(1e9, 200, 20, 1_000, 5)).toEqual({ start: 994, end: 1_000 });
    expect(visibleLineRange(0, 200, 20, 0, 5)).toEqual({ start: 0, end: 0 });
  });

  it("scrolls a requested line into the upper third, clamped to the content", () => {
    expect(scrollTopForLine(1, 20, 600, 1_000)).toBe(0);
    expect(scrollTopForLine(101, 20, 600, 1_000)).toBe(1_800);
    expect(scrollTopForLine(1_000, 20, 600, 1_000)).toBe(19_400);
    expect(scrollTopForLine(50_000, 20, 600, 1_000)).toBe(19_400);
  });
});

describe("symbol outline", () => {
  const symbol = (id: string, start: number, end: number, parentSymbolId?: string): SymbolNode => ({
    id,
    name: id,
    kind: parentSymbolId ? "method" : "class",
    fileId: "file:a.ts",
    parentSymbolId,
    startLine: start,
    endLine: end,
    exported: true,
  });

  it("orders by position and computes nesting depth", () => {
    const outline = buildOutline([
      symbol("m2", 30, 40, "C"),
      symbol("C", 10, 50),
      symbol("m1", 12, 20, "C"),
      symbol("f", 60, 70),
    ]);
    expect(outline.map((entry) => [entry.symbol.id, entry.depth])).toEqual([
      ["C", 0],
      ["m1", 1],
      ["m2", 1],
      ["f", 0],
    ]);
    expect(symbolAtLine(outline, 15)?.id).toBe("m1");
    expect(symbolAtLine(outline, 45)?.id).toBe("C");
    expect(symbolAtLine(outline, 55)).toBeNull();
    expect(symbolAtLine(outline, undefined)).toBeNull();
  });
});
