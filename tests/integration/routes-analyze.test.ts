import { describe, expect, it, vi } from "vitest";
import { ERROR_COPY, NDJSON_CONTENT_TYPE, type AnalysisEvent } from "@/analysis/protocol";
import { resetRateLimiters } from "@/lib/rate-limit/limiters";
import { SHA, params, readEvents, request, setupRouteTests } from "./support/http";

/**
 * `GET /api/analyze/[owner]/[repo]` with the analysis service replaced at the
 * module boundary: validation, rate limiting and NDJSON streaming are real.
 */

const mocks = vi.hoisted(() => ({ streamAnalysis: vi.fn() }));

vi.mock("@/analysis/service", () => ({ streamAnalysis: mocks.streamAnalysis }));

const { GET: analyze } = await import("@/app/api/analyze/[owner]/[repo]/route");

setupRouteTests(mocks);

describe("GET /api/analyze/[owner]/[repo]", () => {
  function analyzeRequest(owner: string, repo: string, query = "", ip?: string) {
    return analyze(request(`/api/analyze/${owner}/${repo}${query}`, { ip }), params(owner, repo));
  }

  it("streams NDJSON events ending with the terminal event", async () => {
    mocks.streamAnalysis.mockImplementation(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) => {
        emit({ type: "stage", stage: "connect", status: "start" });
        emit({ type: "stage", stage: "connect", status: "done", message: "Repository found" });
        emit({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } });
      },
    );
    const response = await analyzeRequest("acme", "polyglot", "?ref=release/1.x");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(mocks.streamAnalysis).toHaveBeenCalledWith(
      { owner: "acme", repo: "polyglot", ref: "release/1.x" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    const events = await readEvents(response);
    expect(events.map((event) => event.type)).toEqual(["stage", "stage", "error"]);
  });

  it("omits an empty ref and accepts full commit SHAs", async () => {
    mocks.streamAnalysis.mockImplementation(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) =>
        emit({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } }),
    );
    await (await analyzeRequest("acme", "polyglot", "?ref=")).text();
    expect(mocks.streamAnalysis.mock.calls[0]?.[0]).toEqual({ owner: "acme", repo: "polyglot" });
    await (await analyzeRequest("acme", "polyglot", `?ref=${SHA}`)).text();
    expect(mocks.streamAnalysis.mock.calls[1]?.[0]).toEqual({
      owner: "acme",
      repo: "polyglot",
      ref: SHA,
    });
  });

  it("guarantees exactly one terminal event", async () => {
    mocks.streamAnalysis.mockImplementationOnce(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) => {
        emit({ type: "stage", stage: "connect", status: "start" });
      },
    );
    const silent = await readEvents(await analyzeRequest("acme", "polyglot"));
    expect(silent[silent.length - 1]).toEqual({
      type: "error",
      error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL },
    });

    mocks.streamAnalysis.mockImplementationOnce(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) => {
        emit({ type: "error", error: { code: "TIMEOUT", ...ERROR_COPY.TIMEOUT } });
        emit({ type: "error", error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL } });
        emit({ type: "stage", stage: "tree", status: "start" });
      },
    );
    const doubled = await readEvents(await analyzeRequest("acme", "polyglot"));
    expect(doubled).toEqual([{ type: "error", error: { code: "TIMEOUT", ...ERROR_COPY.TIMEOUT } }]);

    mocks.streamAnalysis.mockImplementationOnce(async () => {
      throw new Error("unexpected");
    });
    const thrown = await readEvents(await analyzeRequest("acme", "polyglot"));
    expect(thrown).toEqual([
      { type: "error", error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL } },
    ]);
  });

  it.each([
    ["-acme", "polyglot", ""],
    ["acme", "..", ""],
    ["acme", "repo.git", ""],
    ["settings", "polyglot", ""],
    ["acme", "polyglot", "?ref=a..b"],
    ["acme", "polyglot", "?ref=%2Fetc"],
  ])("rejects %s/%s%s with 400 and an NDJSON error", async (owner, repo, query) => {
    const response = await analyzeRequest(owner, repo, query);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    expect(await readEvents(response)).toEqual([
      { type: "error", error: { code: "INVALID_REPOSITORY", ...ERROR_COPY.INVALID_REPOSITORY } },
    ]);
    expect(mocks.streamAnalysis).not.toHaveBeenCalled();
  });

  it("rate limits each client and answers 429 with Retry-After", async () => {
    vi.stubEnv("CODEVERSE_RATE_LIMIT_PER_MINUTE", "2");
    resetRateLimiters();
    mocks.streamAnalysis.mockImplementation(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) =>
        emit({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } }),
    );
    expect((await analyzeRequest("acme", "polyglot")).status).toBe(200);
    expect((await analyzeRequest("acme", "polyglot")).status).toBe(200);
    const limited = await analyzeRequest("acme", "polyglot");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const [event] = await readEvents(limited);
    expect(event).toMatchObject({
      type: "error",
      error: { code: "CLIENT_RATE_LIMITED", title: ERROR_COPY.CLIENT_RATE_LIMITED.title },
    });
    if (event?.type === "error")
      expect(Date.parse(event.error.retryAt ?? "")).toBeGreaterThan(Date.now());
    // Another client is unaffected.
    expect((await analyzeRequest("acme", "polyglot", "", "198.51.100.1")).status).toBe(200);
    expect(mocks.streamAnalysis).toHaveBeenCalledTimes(3);
  });

  it("does not rate limit when the limit is 0", async () => {
    vi.stubEnv("CODEVERSE_RATE_LIMIT_PER_MINUTE", "0");
    resetRateLimiters();
    mocks.streamAnalysis.mockImplementation(
      async (_request: unknown, emit: (event: AnalysisEvent) => void) =>
        emit({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } }),
    );
    for (let index = 0; index < 20; index += 1) {
      expect((await analyzeRequest("acme", "polyglot")).status).toBe(200);
    }
  });

  it("aborts the analysis when the client disconnects", async () => {
    let observed: AbortSignal | undefined;
    const aborted = new Promise<void>((resolve) => {
      mocks.streamAnalysis.mockImplementation(
        async (_request: unknown, emit: (event: AnalysisEvent) => void, signal: AbortSignal) => {
          observed = signal;
          emit({ type: "stage", stage: "connect", status: "start" });
          await new Promise<void>((done) =>
            signal.addEventListener("abort", () => done(), { once: true }),
          );
          resolve();
        },
      );
    });
    const controller = new AbortController();
    const response = await analyze(
      request("/api/analyze/acme/polyglot", { signal: controller.signal }),
      params("acme", "polyglot"),
    );
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain('"connect"');
    controller.abort();
    await aborted;
    expect(observed?.aborted).toBe(true);
    await reader?.cancel();
  });
});
