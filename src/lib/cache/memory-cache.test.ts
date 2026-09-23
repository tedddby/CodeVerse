import { describe, expect, it } from "vitest";
import { MemoryCache } from "./memory-cache";
import { approximateSizeOf } from "./size";

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("MemoryCache", () => {
  it("stores and returns values synchronously visible after set", async () => {
    const cache = new MemoryCache<string>({ maxBytes: 1_000, sizeOf: () => 1 });
    const pending = cache.set("a", "alpha");
    // The entry is visible before the promise settles.
    expect(cache.size).toBe(1);
    await pending;
    expect(await cache.get("a")).toBe("alpha");
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("evicts least recently used entries beyond the byte budget", async () => {
    const cache = new MemoryCache<string>({ maxBytes: 30, sizeOf: () => 10 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.set("c", "3");
    // Touch "a" so "b" becomes the least recently used entry.
    expect(await cache.get("a")).toBe("1");
    await cache.set("d", "4");
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe("1");
    expect(await cache.get("c")).toBe("3");
    expect(await cache.get("d")).toBe("4");
    expect(cache.totalBytes).toBe(30);
  });

  it("honours explicit sizes and refuses values larger than the whole budget", async () => {
    const cache = new MemoryCache<string>({ maxBytes: 100 });
    await cache.set("small", "x", { sizeBytes: 40 });
    await cache.set("huge", "y", { sizeBytes: 101 });
    expect(await cache.get("huge")).toBeUndefined();
    expect(await cache.get("small")).toBe("x");
    // Replacing an entry releases its previous size.
    await cache.set("small", "z", { sizeBytes: 90 });
    expect(cache.totalBytes).toBe(90);
  });

  it("expires entries after their TTL", async () => {
    const time = clock();
    const cache = new MemoryCache<string>({
      maxBytes: 1_000,
      defaultTtlMs: 100,
      now: time.now,
      sizeOf: () => 1,
    });
    await cache.set("default", "a");
    await cache.set("long", "b", { ttlMs: 1_000 });
    time.advance(99);
    expect(await cache.get("default")).toBe("a");
    time.advance(1);
    expect(await cache.get("default")).toBeUndefined();
    expect(await cache.get("long")).toBe("b");
    expect(cache.size).toBe(1);
  });

  it("drops expired entries before evicting live ones", async () => {
    const time = clock();
    const cache = new MemoryCache<string>({ maxBytes: 20, now: time.now, sizeOf: () => 10 });
    await cache.set("short", "a", { ttlMs: 5 });
    await cache.set("live", "b");
    time.advance(10);
    await cache.set("new", "c");
    expect(await cache.get("live")).toBe("b");
    expect(await cache.get("new")).toBe("c");
  });

  it("bounds the number of entries", async () => {
    const cache = new MemoryCache<number>({ maxBytes: 1_000_000, maxEntries: 2, sizeOf: () => 1 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(await cache.get("a")).toBeUndefined();
  });

  it("does not cache values whose size cannot be measured", async () => {
    const cache = new MemoryCache<object>({
      maxBytes: 1_000,
      sizeOf: () => {
        throw new Error("unmeasurable");
      },
    });
    await cache.set("a", {});
    expect(await cache.get("a")).toBeUndefined();
  });

  it("deletes and clears", async () => {
    const cache = new MemoryCache<string>({ maxBytes: 100, sizeOf: () => 1 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.delete("a");
    expect(await cache.get("a")).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.totalBytes).toBe(0);
  });
});

describe("approximateSizeOf", () => {
  it("grows with content and counts shared references once", () => {
    const small = approximateSizeOf({ name: "a" });
    const large = approximateSizeOf({ name: "a".repeat(1_000) });
    expect(large - small).toBe(999 * 2);
    const shared = { payload: "x".repeat(10_000) };
    const once = approximateSizeOf([shared]);
    const twice = approximateSizeOf([shared, shared]);
    expect(twice - once).toBe(8);
  });

  it("handles cycles and deep nesting without overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(approximateSizeOf(cyclic)).toBeGreaterThan(0);
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 100_000; index += 1) deep = { next: deep };
    expect(approximateSizeOf(deep)).toBeGreaterThan(100_000);
  });
});
