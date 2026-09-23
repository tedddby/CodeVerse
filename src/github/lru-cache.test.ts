import { describe, expect, it, vi } from "vitest";
import { SourceError } from "@/sources/types";
import { ExpiringCache, LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<string, number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "a" becomes most recent
    cache.set("c", 3);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("bounds the total weight and skips values heavier than the budget", () => {
    const cache = new LruCache<string, string>({
      maxEntries: 10,
      maxWeight: 10,
      weigh: (value) => value.length,
    });
    cache.set("a", "aaaa");
    cache.set("b", "bbbb");
    cache.set("c", "cccc");
    expect(cache.has("a")).toBe(false);
    expect(cache.totalWeight).toBe(8);
    cache.set("huge", "x".repeat(11));
    expect(cache.has("huge")).toBe(false);
    expect(cache.totalWeight).toBe(8);
  });

  it("replaces existing keys without double counting weight", () => {
    const cache = new LruCache<string, string>({ maxEntries: 5, weigh: (value) => value.length });
    cache.set("a", "12345");
    cache.set("a", "12");
    expect(cache.totalWeight).toBe(2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.totalWeight).toBe(0);
  });
});

describe("ExpiringCache", () => {
  it("de-duplicates concurrent loads and serves cached values until the TTL expires", async () => {
    let now = 0;
    const cache = new ExpiringCache<number>({ maxEntries: 10, now: () => now });
    const loader = vi.fn(async () => 42);
    const [a, b] = await Promise.all([
      cache.load("k", 1000, loader),
      cache.load("k", 1000, loader),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
    now = 999;
    await cache.load("k", 1000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    now = 1001;
    await cache.load("k", 1000, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("evicts failures immediately unless they are negatively cacheable", async () => {
    let now = 0;
    const cache = new ExpiringCache<number>({ maxEntries: 10, now: () => now });
    const failing = vi.fn(async () => {
      throw new SourceError("UPSTREAM_ERROR", "boom");
    });
    await expect(cache.load("k", 1000, failing)).rejects.toThrow("boom");
    await expect(cache.load("k", 1000, failing)).rejects.toThrow("boom");
    expect(failing).toHaveBeenCalledTimes(2);

    const notFound = vi.fn(async () => {
      throw new SourceError("NOT_FOUND", "missing");
    });
    const errorTtl = (error: unknown) =>
      error instanceof SourceError && error.code === "NOT_FOUND" ? 500 : 0;
    await expect(cache.load("n", 1000, notFound, errorTtl)).rejects.toThrow("missing");
    await expect(cache.load("n", 1000, notFound, errorTtl)).rejects.toThrow("missing");
    expect(notFound).toHaveBeenCalledTimes(1);
    now = 501;
    await expect(cache.load("n", 1000, notFound, errorTtl)).rejects.toThrow("missing");
    expect(notFound).toHaveBeenCalledTimes(2);
  });
});
