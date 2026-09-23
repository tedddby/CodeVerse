import { describe, expect, it, vi } from "vitest";
import { ANALYZER_VERSION } from "@/analysis/version";
import { SourceError } from "@/sources/types";
import packageJson from "../../package.json";
import { params, request, setupRouteTests } from "./support/http";

/**
 * `GET /api/repo/[owner]/[repo]` (GitHub provider replaced at the module
 * boundary) and `GET /api/health`.
 */

const mocks = vi.hoisted(() => ({ fetchRepositorySummary: vi.fn() }));

vi.mock("@/sources/github", () => ({ fetchRepositorySummary: mocks.fetchRepositorySummary }));

const { GET: repoSummary } = await import("@/app/api/repo/[owner]/[repo]/route");
const { GET: health } = await import("@/app/api/health/route");

setupRouteTests(mocks);

describe("GET /api/repo/[owner]/[repo]", () => {
  function summaryRequest(owner: string, repo: string) {
    return repoSummary(request(`/api/repo/${owner}/${repo}`), params(owner, repo));
  }

  it("returns the repository summary with a shared cache policy", async () => {
    const summary = { id: "github:acme/polyglot", fullName: "acme/polyglot", stars: 3 };
    mocks.fetchRepositorySummary.mockResolvedValue(summary);
    const response = await summaryRequest("acme", "polyglot");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
    expect(await response.json()).toEqual(summary);
    expect(mocks.fetchRepositorySummary).toHaveBeenCalledWith(
      "acme",
      "polyglot",
      expect.any(AbortSignal),
    );
  });

  it.each([
    [new SourceError("NOT_FOUND", "x"), 404, "NOT_FOUND"],
    [new SourceError("PRIVATE_OR_INACCESSIBLE", "x"), 403, "PRIVATE_OR_INACCESSIBLE"],
    [new SourceError("TIMEOUT", "x"), 504, "TIMEOUT"],
    [new SourceError("UPSTREAM_ERROR", "x"), 502, "UPSTREAM_ERROR"],
    [new SourceError("INVALID_RESPONSE", "x"), 502, "UPSTREAM_ERROR"],
    [new Error("database exploded"), 500, "INTERNAL"],
  ])("maps %s to %i", async (error, status, code) => {
    mocks.fetchRepositorySummary.mockRejectedValue(error);
    const response = await summaryRequest("acme", "polyglot");
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain("exploded");
  });

  it("forwards provider rate limits with Retry-After", async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString();
    mocks.fetchRepositorySummary.mockRejectedValue(
      new SourceError("RATE_LIMITED", "x", { retryAt }),
    );
    const response = await summaryRequest("acme", "polyglot");
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(119);
  });

  it("rejects invalid names before calling GitHub", async () => {
    const response = await summaryRequest("acme", "bad name");
    expect(response.status).toBe(400);
    expect(mocks.fetchRepositorySummary).not.toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  it("reports versions and token presence, never the token", async () => {
    const token = "ghp_healthCheckSecretValue1234567890";
    vi.stubEnv("GITHUB_TOKEN", token);
    const response = health();
    const text = await response.text();
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toEqual({
      status: "ok",
      version: packageJson.version,
      analyzerVersion: ANALYZER_VERSION,
      tokenConfigured: true,
      uptimeSeconds: expect.any(Number),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a missing token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "  ");
    expect(((await health().json()) as { tokenConfigured: boolean }).tokenConfigured).toBe(false);
  });
});
