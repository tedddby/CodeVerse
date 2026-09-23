import { describe, expect, it, vi } from "vitest";
import type { SourceErrorResponse, SourceFileResponse } from "@/analysis/source-protocol";
import { SourceError } from "@/sources/types";
import { RESOLVED_SHA, SHA, params, request, setupRouteTests } from "./support/http";

/**
 * `GET /api/source/[owner]/[repo]` with the GitHub provider replaced at the
 * module boundary: path/ref validation, ref resolution, response mapping,
 * caching headers, coalescing and rate limiting are real.
 */

const mocks = vi.hoisted(() => ({ getRawFile: vi.fn(), getSnapshot: vi.fn() }));

vi.mock("@/sources/github", () => ({
  createGitHubSource: () => ({ getSnapshot: mocks.getSnapshot }),
  getSharedGitHubClient: () => ({ getRawFile: mocks.getRawFile }),
}));

const { GET: source } = await import("@/app/api/source/[owner]/[repo]/route");

setupRouteTests(mocks);

describe("GET /api/source/[owner]/[repo]", () => {
  function sourceRequest(
    query: Record<string, string>,
    owner = "acme",
    repo = "polyglot",
    ip?: string,
  ) {
    const search = new URLSearchParams(query).toString();
    return source(request(`/api/source/${owner}/${repo}?${search}`, { ip }), params(owner, repo));
  }

  async function errorBody(response: Response): Promise<SourceErrorResponse["error"]> {
    return ((await response.json()) as SourceErrorResponse).error;
  }

  it("serves a file at a pinned commit with an immutable cache policy", async () => {
    mocks.getRawFile.mockResolvedValue({
      kind: "text",
      content: "export const a = 1;\nexport const b = 2;\n",
      size: 40,
    });
    const response = await sourceRequest({ ref: SHA.toUpperCase(), path: "src/app.ts" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = (await response.json()) as SourceFileResponse;
    expect(body).toEqual({
      path: "src/app.ts",
      ref: SHA,
      size: 40,
      content: "export const a = 1;\nexport const b = 2;\n",
      language: "typescript",
      lines: 2,
    });
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.getRawFile).toHaveBeenCalledWith("acme", "polyglot", SHA, "src/app.ts", {
      maxBytes: 1024 * 1024,
    });
  });

  it("resolves branch names to a commit and caches briefly", async () => {
    mocks.getSnapshot.mockResolvedValue({
      repository: { owner: "Acme", name: "Polyglot", commitSha: RESOLVED_SHA },
    });
    mocks.getRawFile.mockResolvedValue({ kind: "text", content: "print('hi')\n", size: 12 });
    const response = await sourceRequest({ ref: "main", path: "tools/run.py" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(((await response.json()) as SourceFileResponse).ref).toBe(RESOLVED_SHA);
    expect(mocks.getRawFile).toHaveBeenCalledWith(
      "Acme",
      "Polyglot",
      RESOLVED_SHA,
      "tools/run.py",
      {
        maxBytes: 1024 * 1024,
      },
    );
  });

  it.each([
    ["../etc/passwd"],
    ["src/../../secret"],
    ["./src/app.ts"],
    ["/etc/passwd"],
    ["src//app.ts"],
    ["src/%2e%2e/app.ts"],
    ["src/app\u0000.ts"],
    ["src/app\n.ts"],
    ["a".repeat(1_025)],
    [""],
  ])("rejects the unsafe path %j with 400", async (unsafePath) => {
    const response = await sourceRequest({ ref: SHA, path: unsafePath });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).code).toBe("INVALID_REQUEST");
    expect(mocks.getRawFile).not.toHaveBeenCalled();
  });

  it("requires a valid repository and ref", async () => {
    expect((await sourceRequest({ path: "a.ts" })).status).toBe(400);
    expect((await sourceRequest({ ref: "a..b", path: "a.ts" })).status).toBe(400);
    expect((await sourceRequest({ ref: SHA, path: "a.ts" }, "-bad-")).status).toBe(400);
    expect((await sourceRequest({ ref: SHA })).status).toBe(400);
    expect(mocks.getRawFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "binary", size: 10 }, 415, "BINARY"],
    [{ kind: "too-large", size: 5_000_000 }, 413, "TOO_LARGE"],
    [{ kind: "missing" }, 404, "NOT_FOUND"],
  ])("maps %j to %i", async (result, status, code) => {
    mocks.getRawFile.mockResolvedValue(result);
    const response = await sourceRequest({ ref: SHA, path: "assets/file.bin" });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await errorBody(response)).code).toBe(code);
  });

  it("explains the viewer size limit", async () => {
    mocks.getRawFile.mockResolvedValue({ kind: "too-large", size: 5_000_000 });
    const body = await errorBody(await sourceRequest({ ref: SHA, path: "big.json" }));
    expect(body.message).toContain("1.0 MB");
  });

  it("maps provider failures without leaking their messages", async () => {
    const retryAt = new Date(Date.now() + 90_000).toISOString();
    mocks.getRawFile.mockRejectedValueOnce(
      new SourceError("RATE_LIMITED", "raw host throttled token=abc", { retryAt }),
    );
    const limited = await sourceRequest({ ref: SHA, path: "a.ts" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(89);

    mocks.getRawFile.mockRejectedValueOnce(new SourceError("UPSTREAM_ERROR", "HTTP 503 from raw"));
    const upstream = await sourceRequest({ ref: SHA, path: "a.ts" });
    expect(upstream.status).toBe(502);
    expect(JSON.stringify(await upstream.json())).not.toContain("503");

    mocks.getRawFile.mockRejectedValueOnce(new TypeError("boom"));
    const internal = await sourceRequest({ ref: SHA, path: "a.ts" });
    expect(internal.status).toBe(500);
    expect((await errorBody(internal)).code).toBe("INTERNAL");

    mocks.getSnapshot.mockRejectedValueOnce(new SourceError("REF_NOT_FOUND", "no such branch"));
    const missingRef = await sourceRequest({ ref: "nope", path: "a.ts" });
    expect(missingRef.status).toBe(404);
    expect((await errorBody(missingRef)).message).toMatch(/branch, tag or commit/);
  });

  it("shares one download between identical concurrent requests", async () => {
    let release: () => void = () => undefined;
    mocks.getRawFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ kind: "text", content: "x\n", size: 2 });
        }),
    );
    const pending = [
      sourceRequest({ ref: SHA, path: "shared.ts" }),
      sourceRequest({ ref: SHA, path: "shared.ts" }, "ACME", "POLYGLOT"),
    ];
    await vi.waitFor(() => expect(mocks.getRawFile).toHaveBeenCalledTimes(1));
    release();
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.getRawFile).toHaveBeenCalledTimes(1);
  });

  it("rate limits source requests per client", async () => {
    mocks.getRawFile.mockResolvedValue({ kind: "text", content: "x\n", size: 2 });
    let limited: Response | undefined;
    for (let index = 0; index < 100 && !limited; index += 1) {
      const response = await sourceRequest(
        { ref: SHA, path: `f${index}.ts` },
        "acme",
        "polyglot",
        "192.0.2.9",
      );
      if (response.status === 429) limited = response;
    }
    expect(limited).toBeDefined();
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect(mocks.getRawFile.mock.calls.length).toBeLessThan(100);
  });
});
