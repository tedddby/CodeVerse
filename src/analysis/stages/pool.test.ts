import { describe, expect, it } from "vitest";
import { runPool } from "./pool";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("runPool", () => {
  it("never runs more than `concurrency` workers at once and processes items in order", async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const count = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      started.push(item);
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });
    expect(count).toBe(7);
    expect(peak).toBe(3);
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("stops starting items once shouldStart returns false", async () => {
    const seen: number[] = [];
    const started = await runPool(
      [1, 2, 3, 4, 5],
      1,
      async (item) => {
        seen.push(item);
      },
      () => seen.length < 2,
    );
    expect(started).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("rejects with the first worker error and starts nothing more", async () => {
    const seen: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 1, async (item) => {
        seen.push(item);
        if (item === 2) throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(seen).toEqual([1, 2]);
  });

  it("handles empty input and degenerate concurrency", async () => {
    expect(await runPool([], 4, async () => undefined)).toBe(0);
    expect(await runPool([1, 2], 0, async () => undefined)).toBe(2);
  });
});
