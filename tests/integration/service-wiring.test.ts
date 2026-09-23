import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisEvent } from "@/analysis/protocol";
import { SourceError } from "@/sources/types";

/**
 * The production service module (`@/analysis/service`) with only the GitHub
 * provider replaced by an in-memory repository: real parser, graph builders,
 * process-wide caches and single-flight.
 */

vi.mock("@/sources/github", async () => {
  const { MemorySource } = await import("@/sources/memory");
  const { polyglotSpec, REPOSITORY } = await import("./support/polyglot-repository");
  return {
    createGitHubSource: (request: { owner: string; repo: string }) => {
      if (request.repo === "missing") {
        return {
          getSnapshot: () => Promise.reject(new SourceError("NOT_FOUND", "Not Found")),
        };
      }
      return new MemorySource(
        polyglotSpec({ repository: { ...REPOSITORY, owner: request.owner, name: request.repo } }),
      );
    },
  };
});

vi.stubEnv("CODEVERSE_CACHE_DIR", "");
const service = await import("@/analysis/service");

const GLOBAL_KEYS = [
  "codeverse.analysis.service",
  "codeverse.cache.graphs",
  "codeverse.cache.graphPointers",
];

afterAll(() => {
  // The service and caches are process-wide singletons; leave nothing behind for other files.
  const holder = globalThis as Record<symbol, unknown>;
  for (const key of GLOBAL_KEYS) delete holder[Symbol.for(key)];
  vi.unstubAllEnvs();
});

beforeEach(() => {
  // Summary log lines are expected; keep the test output readable.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

async function collect(repo: string): Promise<AnalysisEvent[]> {
  const events: AnalysisEvent[] = [];
  await service.streamAnalysis(
    { owner: "acme", repo },
    (event) => events.push(event),
    new AbortController().signal,
  );
  return events;
}

describe("@/analysis/service", () => {
  it("analyses, caches and exposes the latest graph", async () => {
    expect(await service.peekCachedGraph("acme", "wired")).toBeNull();
    const first = await collect("wired");
    const complete = first.at(-1);
    expect(complete?.type).toBe("complete");
    if (complete?.type !== "complete") return;
    expect(complete.graph.repository.fullName).toBe("acme/wired");
    expect(complete.graph.analysis.cached).toBe(false);
    expect(complete.graph.files.some((file) => file.status === "parsed")).toBe(true);

    const second = await collect("wired");
    const replayed = second.at(-1);
    expect(replayed?.type === "complete" && replayed.graph.analysis.cached).toBe(true);

    const peeked = await service.peekCachedGraph("ACME", "Wired");
    expect(peeked?.repository.commitSha).toBe(complete.graph.repository.commitSha);
  });

  it("turns provider failures into one error event", async () => {
    const events = await collect("missing");
    expect(events.map((event) => event.type)).toEqual(["stage", "error"]);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "NOT_FOUND" } });
  });

  it("re-exports the error mapping", () => {
    expect(service.toErrorPayload(new SourceError("REF_NOT_FOUND", "x")).code).toBe(
      "REF_NOT_FOUND",
    );
  });
});

describe("readMaxConcurrentAnalyses", () => {
  it("accepts positive integers only", () => {
    expect(service.readMaxConcurrentAnalyses({})).toBe(4);
    expect(service.readMaxConcurrentAnalyses({ CODEVERSE_MAX_CONCURRENT_ANALYSES: "8" })).toBe(8);
    expect(service.readMaxConcurrentAnalyses({ CODEVERSE_MAX_CONCURRENT_ANALYSES: "0" })).toBe(4);
    expect(service.readMaxConcurrentAnalyses({ CODEVERSE_MAX_CONCURRENT_ANALYSES: "two" })).toBe(4);
  });
});
