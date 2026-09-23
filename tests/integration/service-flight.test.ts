import { describe, expect, it } from "vitest";
import { remainingBudget } from "@/analysis/analysis-service";
import { BUSY_COPY } from "@/analysis/errors";
import { ERROR_COPY } from "@/analysis/protocol";
import { SourceError } from "@/sources/types";
import { memorySource, overrideSource, testLimits } from "./support/harness";
import { polyglotSpec } from "./support/polyglot-repository";
import {
  REQUEST,
  collect,
  completedGraph,
  createHarness,
  errorOf,
  terminalEvents,
} from "./support/service-harness";

/**
 * The analysis service around a running analysis: request coalescing,
 * cancellation, concurrency control, time limits and error reporting.
 */

describe("single flight", () => {
  it("shares one analysis between concurrent identical requests", async () => {
    const harness = createHarness({
      source: () => memorySource(polyglotSpec({ readDelayMs: 5 })),
    });
    const [first, second] = await Promise.all([collect(harness), collect(harness)]);
    expect(harness.counters.listTree).toBe(1);
    expect(completedGraph(first)).toEqual(completedGraph(second));
    for (const events of [first, second]) {
      expect(terminalEvents(events)).toHaveLength(1);
      expect(events.some((event) => event.type === "preview")).toBe(true);
    }
  });

  it("keeps the shared analysis alive while any subscriber is connected", async () => {
    const harness = createHarness({
      source: () => memorySource(polyglotSpec({ readDelayMs: 5 })),
    });
    const leaving = new AbortController();
    const firstRun = collect(harness, REQUEST, leaving.signal, (event) => {
      if (event.type === "preview") leaving.abort();
    });
    const second = collect(harness);
    const [first, remaining] = await Promise.all([firstRun, second]);
    expect(terminalEvents(first)).toHaveLength(0);
    expect(completedGraph(remaining).analysis.cached).toBe(false);
    // The completed analysis was cached for later requests.
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(true);
    expect(harness.counters.listTree).toBe(1);
  });

  it("aborts the analysis when every subscriber has left and caches nothing", async () => {
    const harness = createHarness({
      source: () => memorySource(polyglotSpec({ readDelayMs: 5 })),
    });
    const controller = new AbortController();
    const events = await collect(harness, REQUEST, controller.signal, (event) => {
      if (event.type === "stage" && event.stage === "fetch" && event.status === "start")
        controller.abort();
    });
    expect(terminalEvents(events)).toHaveLength(0);
    const readsAtAbort = harness.counters.readFile;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.counters.readFile).toBeLessThanOrEqual(readsAtAbort + 1);
    expect(await harness.service.peekCachedGraph("acme", "polyglot")).toBeNull();
    expect(completedGraph(await collect(harness)).analysis.cached).toBe(false);
    expect(harness.counters.listTree).toBe(2);
  });
});

describe("concurrency control", () => {
  it("deducts queueing time from the analysis budget, keeping at least a quarter", () => {
    expect(remainingBudget(110_000, 0)).toBe(110_000);
    expect(remainingBudget(110_000, 30_000)).toBe(80_000);
    expect(remainingBudget(110_000, 200_000)).toBe(27_500);
    expect(remainingBudget(110_000, -5)).toBe(110_000);
  });

  it("queues analyses beyond the concurrency limit and tells the client", async () => {
    const harness = createHarness({
      source: (request) =>
        memorySource(
          polyglotSpec({
            repository: { ...polyglotSpec().repository, name: request.repo },
            readDelayMs: 2,
          }),
        ),
      deps: { maxConcurrentAnalyses: 1 },
    });
    const [first, second] = await Promise.all([
      collect(harness, { owner: "acme", repo: "one" }),
      collect(harness, { owner: "acme", repo: "two" }),
    ]);
    expect(completedGraph(first).repository.name).toBe("one");
    expect(completedGraph(second).repository.name).toBe("two");
    expect(second).toContainEqual({
      type: "stage",
      stage: "connect",
      status: "progress",
      message: "Waiting for a free analysis slot",
    });
  });

  it("reports a busy server when no slot frees up in time", async () => {
    const harness = createHarness({
      source: (request) =>
        memorySource(
          polyglotSpec({
            repository: { ...polyglotSpec().repository, name: request.repo },
            readDelayMs: 10,
          }),
        ),
      deps: { maxConcurrentAnalyses: 1, maxQueueWaitMs: 5 },
    });
    const [, second] = await Promise.all([
      collect(harness, { owner: "acme", repo: "one" }),
      collect(harness, { owner: "acme", repo: "two" }),
    ]);
    expect(errorOf(second)).toEqual({ code: "CLIENT_RATE_LIMITED", ...BUSY_COPY });
  });

  it("aborts analyses that exceed the hard time limit with TIMEOUT", async () => {
    const harness = createHarness({
      source: () => memorySource(polyglotSpec({ readDelayMs: 200 })),
      deps: { getLimits: () => testLimits({ analysisBudgetMs: 30 }), hardTimeoutGraceMs: 0 },
    });
    const events = await collect(harness);
    expect(errorOf(events)).toEqual({ code: "TIMEOUT", ...ERROR_COPY.TIMEOUT });
    expect(terminalEvents(events)).toHaveLength(1);
  });
});

describe("errors", () => {
  it("reports provider failures with the canonical copy only", async () => {
    const harness = createHarness({
      source: () =>
        overrideSource(memorySource(polyglotSpec()), {
          getSnapshot: () =>
            Promise.reject(
              new SourceError("NOT_FOUND", "GitHub said: Not Found (token ghp_abcdef123456)"),
            ),
        }),
    });
    const events = await collect(harness);
    expect(events).toEqual([
      { type: "stage", stage: "connect", status: "start" },
      { type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } },
    ]);
  });

  it("passes the retry time of provider rate limits", async () => {
    const harness = createHarness({
      source: () =>
        overrideSource(memorySource(polyglotSpec()), {
          getSnapshot: () =>
            Promise.reject(
              new SourceError("RATE_LIMITED", "quota", { retryAt: "2026-09-23T13:00:00Z" }),
            ),
        }),
    });
    expect(errorOf(await collect(harness))).toEqual({
      code: "RATE_LIMITED",
      ...ERROR_COPY.RATE_LIMITED,
      retryAt: "2026-09-23T13:00:00.000Z",
    });
  });

  it("hides unexpected failures behind a generic INTERNAL error", async () => {
    const harness = createHarness({
      source: () =>
        overrideSource(memorySource(polyglotSpec()), {
          listTree: () =>
            Promise.reject(new TypeError("Cannot read properties of undefined (secret=abc)")),
        }),
    });
    const events = await collect(harness);
    expect(errorOf(events)).toEqual({ code: "INTERNAL", ...ERROR_COPY.INTERNAL });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("reports invalid input and empty repositories", async () => {
    const invalid = createHarness({
      source: () => {
        throw new SourceError("INVALID_REPOSITORY", "bad name");
      },
    });
    expect(errorOf(await collect(invalid)).code).toBe("INVALID_REPOSITORY");
    const empty = createHarness({ source: () => memorySource(polyglotSpec({ files: {} })) });
    expect(errorOf(await collect(empty)).code).toBe("EMPTY_REPOSITORY");
  });

  it("emits nothing more once the client has disconnected", async () => {
    const harness = createHarness({ source: () => memorySource(polyglotSpec({ readDelayMs: 5 })) });
    const controller = new AbortController();
    const events = await collect(harness, REQUEST, controller.signal, (event) => {
      if (event.type === "preview") controller.abort();
    });
    const previewIndex = events.findIndex((event) => event.type === "preview");
    expect(events.slice(previewIndex + 1)).toEqual([]);
  });

  it("isolates a throwing event consumer", async () => {
    const harness = createHarness();
    let calls = 0;
    await expect(
      harness.service.streamAnalysis(
        REQUEST,
        () => {
          calls += 1;
          throw new Error("consumer bug");
        },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toBeGreaterThan(5);
  });
});
