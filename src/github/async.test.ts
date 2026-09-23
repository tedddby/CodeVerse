import { describe, expect, it } from "vitest";
import { chunk, mapWithConcurrency, raceWithSignal, sleep } from "./async";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  it("stops starting new tasks after a failure", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4], 1, async (value) => {
        started.push(value);
        if (value === 1) throw new Error("fail");
        return value;
      }),
    ).rejects.toThrow("fail");
    expect(started).toEqual([0, 1]);
  });

  it("handles empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("sleep / raceWithSignal", () => {
  it("rejects with ABORTED when the signal fires during a sleep", async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("rejects immediately for an already aborted signal", async () => {
    await expect(sleep(1, AbortSignal.abort())).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("lets one caller stop waiting without cancelling the shared work", async () => {
    const shared = deferred<number>();
    const controller = new AbortController();
    const first = raceWithSignal(shared.promise, controller.signal);
    const second = raceWithSignal(shared.promise, undefined);
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "ABORTED" });
    shared.resolve(7);
    await expect(second).resolves.toBe(7);
  });
});

describe("chunk", () => {
  it("splits into consecutive chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
