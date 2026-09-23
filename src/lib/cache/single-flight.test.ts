import { describe, expect, it } from "vitest";
import { inFlightCount, singleFlight } from "./single-flight";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleFlight", () => {
  it("runs one execution for concurrent calls with the same key", async () => {
    const gate = deferred<string>();
    let runs = 0;
    const work = () => {
      runs += 1;
      return gate.promise;
    };
    const first = singleFlight("test:a", work);
    const second = singleFlight("test:a", work);
    const other = singleFlight("test:b", async () => "b");
    expect(runs).toBe(1);
    gate.resolve("a");
    expect(await Promise.all([first, second, other])).toEqual(["a", "a", "b"]);
  });

  it("releases the key once settled so later calls run again", async () => {
    let runs = 0;
    await singleFlight("test:c", async () => (runs += 1));
    await singleFlight("test:c", async () => (runs += 1));
    expect(runs).toBe(2);
    expect(inFlightCount()).toBe(0);
  });

  it("shares rejections and then forgets them", async () => {
    const gate = deferred<string>();
    const first = singleFlight("test:d", () => gate.promise);
    const second = singleFlight("test:d", () => Promise.resolve("never"));
    gate.reject(new Error("upstream down"));
    await expect(first).rejects.toThrow("upstream down");
    await expect(second).rejects.toThrow("upstream down");
    expect(await singleFlight("test:d", async () => "recovered")).toBe("recovered");
  });

  it("turns a synchronous throw into a rejection without registering the key", async () => {
    await expect(
      singleFlight("test:e", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(inFlightCount()).toBe(0);
  });
});
