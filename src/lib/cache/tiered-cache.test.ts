import { describe, expect, it } from "vitest";
import { MemoryCache } from "./memory-cache";
import { TieredCache } from "./tiered-cache";
import type { Cache } from "./types";

function memory(): MemoryCache<string> {
  return new MemoryCache<string>({ maxBytes: 1_000, sizeOf: () => 1 });
}

function failing(): Cache<string> {
  return {
    get: () => Promise.reject(new Error("read failed")),
    set: () => Promise.reject(new Error("write failed")),
    delete: () => Promise.reject(new Error("delete failed")),
  };
}

describe("TieredCache", () => {
  it("reads through tiers and backfills faster ones", async () => {
    const fast = memory();
    const slow = memory();
    await slow.set("key", "value");
    const cache = new TieredCache([fast, slow]);
    expect(await cache.get("key")).toBe("value");
    expect(await fast.get("key")).toBe("value");
  });

  it("writes and deletes in every tier, the first one synchronously", async () => {
    const fast = memory();
    const slow = memory();
    const cache = new TieredCache([fast, slow]);
    const pending = cache.set("key", "value");
    expect(fast.size).toBe(1);
    await pending;
    expect(await slow.get("key")).toBe("value");
    await cache.delete("key");
    expect(await fast.get("key")).toBeUndefined();
    expect(await slow.get("key")).toBeUndefined();
  });

  it("treats a failing tier as a miss and still writes the healthy tiers", async () => {
    const healthy = memory();
    const cache = new TieredCache([healthy, failing()]);
    await expect(cache.set("key", "value")).rejects.toThrow("write failed");
    expect(await healthy.get("key")).toBe("value");
    expect(await new TieredCache([failing(), healthy]).get("key")).toBe("value");
    expect(await new TieredCache([failing()]).get("key")).toBeUndefined();
  });

  it("requires at least one tier", () => {
    expect(() => new TieredCache<string>([])).toThrow(RangeError);
  });
});
