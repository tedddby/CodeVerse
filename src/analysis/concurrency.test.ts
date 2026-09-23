import { describe, expect, it } from "vitest";
import { AnalysisBusyError, ConcurrencyGate } from "./concurrency";

describe("ConcurrencyGate", () => {
  it("admits up to the limit and queues the rest in order", async () => {
    const gate = new ConcurrencyGate(2);
    const signal = new AbortController().signal;
    const releaseA = await gate.acquire(signal, 1_000);
    const releaseB = await gate.acquire(signal, 1_000);
    expect(gate.active).toBe(2);
    const order: string[] = [];
    let queued = 0;
    const c = gate
      .acquire(signal, 1_000, () => (queued += 1))
      .then((release) => {
        order.push("c");
        return release;
      });
    const d = gate.acquire(signal, 1_000).then((release) => {
      order.push("d");
      return release;
    });
    expect(gate.waiting).toBe(2);
    expect(queued).toBe(1);
    releaseA();
    releaseA(); // Releasing twice has no effect.
    const releaseC = await c;
    expect(order).toEqual(["c"]);
    releaseB();
    const releaseD = await d;
    expect(order).toEqual(["c", "d"]);
    releaseC();
    releaseD();
    expect(gate.active).toBe(0);
  });

  it("gives up waiting when the signal aborts", async () => {
    const gate = new ConcurrencyGate(1);
    const release = await gate.acquire(new AbortController().signal, 1_000);
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal, 1_000);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
    expect(gate.waiting).toBe(0);
    release();
    expect(gate.active).toBe(0);
  });

  it("reports a busy server after the maximum wait", async () => {
    const gate = new ConcurrencyGate(1);
    await gate.acquire(new AbortController().signal, 1_000);
    await expect(gate.acquire(new AbortController().signal, 5)).rejects.toBeInstanceOf(
      AnalysisBusyError,
    );
    expect(gate.waiting).toBe(0);
  });

  it("rejects an already aborted request without taking a slot", async () => {
    const gate = new ConcurrencyGate(1);
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire(controller.signal, 1_000)).rejects.toMatchObject({ code: "ABORTED" });
    expect(gate.active).toBe(0);
  });
});
