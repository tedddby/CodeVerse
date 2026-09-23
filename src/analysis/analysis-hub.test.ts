import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { SourceError } from "@/sources/types";
import { AnalysisHub, type FlightRunner } from "./analysis-hub";
import type { AnalysisEvent } from "./protocol";

function controllable() {
  let emit: (event: AnalysisEvent) => void = () => undefined;
  let finish: (graph: RepositoryGraph) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  let signal: AbortSignal | undefined;
  let runs = 0;
  const run: FlightRunner = (broadcast, flightSignal) => {
    runs += 1;
    emit = broadcast;
    signal = flightSignal;
    return new Promise<RepositoryGraph>((resolve, reject) => {
      finish = resolve;
      fail = reject;
      flightSignal.addEventListener(
        "abort",
        () => reject(new SourceError("ABORTED", "cancelled")),
        {
          once: true,
        },
      );
    });
  };
  return {
    run,
    emit: (event: AnalysisEvent) => emit(event),
    finish: (graph: RepositoryGraph) => finish(graph),
    fail: (error: unknown) => fail(error),
    signal: () => signal,
    runs: () => runs,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AnalysisHub", () => {
  it("runs one flight per key and fans events out to every subscriber", async () => {
    const hub = new AnalysisHub();
    const flight = controllable();
    const first: AnalysisEvent[] = [];
    const second: AnalysisEvent[] = [];
    const a = hub.join("k", flight.run, (event) => first.push(event), new AbortController().signal);
    await tick();
    flight.emit({ type: "stage", stage: "tree", status: "start" });
    flight.emit({ type: "stage", stage: "tree", status: "progress", progress: 0.2 });
    flight.emit({ type: "stage", stage: "tree", status: "progress", progress: 0.6 });
    const b = hub.join(
      "k",
      flight.run,
      (event) => second.push(event),
      new AbortController().signal,
    );
    flight.emit({ type: "stage", stage: "tree", status: "done" });
    // Terminal events are never broadcast; every subscriber reports its own.
    flight.emit({ type: "complete", graph: mockRepositoryGraph });
    flight.finish(mockRepositoryGraph);

    expect(await a).toEqual({ graph: mockRepositoryGraph, shared: false });
    expect(await b).toEqual({ graph: mockRepositoryGraph, shared: true });
    expect(flight.runs()).toBe(1);
    expect(first.map((event) => (event.type === "stage" ? event.status : event.type))).toEqual([
      "start",
      "progress",
      "progress",
      "done",
    ]);
    // The late subscriber gets a compacted replay (latest progress only), then live events.
    expect(second).toEqual([
      { type: "stage", stage: "tree", status: "start" },
      { type: "stage", stage: "tree", status: "progress", progress: 0.6 },
      { type: "stage", stage: "tree", status: "done" },
    ]);
    expect(hub.activeFlights).toBe(0);
  });

  it("aborts the flight only when the last subscriber leaves", async () => {
    const hub = new AnalysisHub();
    const flight = controllable();
    const leaveA = new AbortController();
    const leaveB = new AbortController();
    const a = hub.join("k", flight.run, () => undefined, leaveA.signal);
    const b = hub.join("k", flight.run, () => undefined, leaveB.signal);
    await tick();
    leaveA.abort();
    await expect(a).rejects.toMatchObject({ code: "ABORTED" });
    expect(flight.signal()?.aborted).toBe(false);
    leaveB.abort();
    await expect(b).rejects.toMatchObject({ code: "ABORTED" });
    expect(flight.signal()?.aborted).toBe(true);
    await tick();
    expect(hub.activeFlights).toBe(0);
  });

  it("shares failures and starts a fresh flight afterwards", async () => {
    const hub = new AnalysisHub();
    const flight = controllable();
    const a = hub.join("k", flight.run, () => undefined, new AbortController().signal);
    const b = hub.join("k", flight.run, () => undefined, new AbortController().signal);
    await tick();
    flight.fail(new SourceError("NOT_FOUND", "missing"));
    await expect(a).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b).rejects.toMatchObject({ code: "NOT_FOUND" });
    const retry = controllable();
    const c = hub.join("k", retry.run, () => undefined, new AbortController().signal);
    await tick();
    retry.finish(mockRepositoryGraph);
    expect((await c).shared).toBe(false);
  });

  it("rejects immediately for an already aborted subscriber without starting a flight", async () => {
    const hub = new AnalysisHub();
    const flight = controllable();
    const controller = new AbortController();
    controller.abort();
    await expect(
      hub.join("k", flight.run, () => undefined, controller.signal),
    ).rejects.toMatchObject({
      code: "ABORTED",
    });
    await tick();
    expect(flight.runs()).toBe(0);
  });

  it("isolates a throwing subscriber", async () => {
    const hub = new AnalysisHub();
    const flight = controllable();
    const healthy: AnalysisEvent[] = [];
    const a = hub.join(
      "k",
      flight.run,
      () => {
        throw new Error("consumer bug");
      },
      new AbortController().signal,
    );
    const b = hub.join(
      "k",
      flight.run,
      (event) => healthy.push(event),
      new AbortController().signal,
    );
    await tick();
    flight.emit({ type: "stage", stage: "fetch", status: "start" });
    flight.finish(mockRepositoryGraph);
    await Promise.all([a, b]);
    expect(healthy).toHaveLength(1);
  });
});

describe("AnalysisHub cancellation races", () => {
  it("starts a fresh flight instead of joining one that is being cancelled", async () => {
    const hub = new AnalysisHub();
    const cancelled = controllable();
    const leaving = new AbortController();
    const first = hub.join("k", cancelled.run, () => undefined, leaving.signal);
    await tick();
    leaving.abort();
    await expect(first).rejects.toMatchObject({ code: "ABORTED" });
    // The cancelled flight has not settled its bookkeeping yet; a new request must not inherit it.
    const fresh = controllable();
    const second = hub.join("k", fresh.run, () => undefined, new AbortController().signal);
    await tick();
    expect(fresh.runs()).toBe(1);
    fresh.finish(mockRepositoryGraph);
    expect(await second).toEqual({ graph: mockRepositoryGraph, shared: false });
  });
});
