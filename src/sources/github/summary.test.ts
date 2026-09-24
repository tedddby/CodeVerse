import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeFetch,
  jsonResponse,
  rateLimitHeaders,
  textResponse,
  type FakeHandler,
} from "@/github/__fixtures__/fake-fetch";
import { repositoryFixture } from "@/github/__fixtures__/github-fixtures";
import { GitHubClient } from "@/github/client";
import { SourceError } from "@/sources/types";
import {
  GitHubClient as ExportedClient,
  GitHubSource,
  createGitHubSource,
  fetchRepositorySummary,
  getSharedGitHubClient,
} from "./index";
import {
  STALE_SUMMARY_MAX_AGE_MS,
  SUMMARY_ERROR_TTL_MS,
  SUMMARY_TTL_MS,
  fetchRepositorySummaryWith,
  reservedQuotaError,
} from "./summary";

function setup(handler: FakeHandler) {
  const fake = createFakeFetch(handler);
  return {
    client: new GitHubClient({ fetchImpl: fake.fetch, maxRetries: 0 }),
    requests: fake.requests,
  };
}

const SHARED_CLIENT_KEY = Symbol.for("codeverse.github.sharedClient");

function resetSharedClient() {
  Reflect.deleteProperty(globalThis, SHARED_CLIENT_KEY);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSharedClient();
});

describe("fetchRepositorySummaryWith", () => {
  it("returns public repository metadata without ref/commit", async () => {
    const { client, requests } = setup(() => jsonResponse(repositoryFixture));
    const summary = await fetchRepositorySummaryWith(client, "facebook", "react");
    expect(summary).toMatchObject({
      id: "github:facebook/react",
      fullName: "facebook/react",
      stars: 239000,
      defaultBranch: "main",
    });
    expect(summary).not.toHaveProperty("commitSha");
    expect(summary).not.toHaveProperty("ref");
    expect(requests).toHaveLength(1);
  });

  it("rejects private repositories", async () => {
    const { client } = setup(() =>
      jsonResponse({ ...repositoryFixture, private: true, visibility: "private" }),
    );
    await expect(fetchRepositorySummaryWith(client, "facebook", "react")).rejects.toMatchObject({
      code: "PRIVATE_OR_INACCESSIBLE",
    });
  });

  it("validates names before any request", async () => {
    const { client, requests } = setup(() => jsonResponse(repositoryFixture));
    await expect(fetchRepositorySummaryWith(client, "bad/owner", "react")).rejects.toMatchObject({
      code: "INVALID_REPOSITORY",
    });
    expect(requests).toHaveLength(0);
  });

  it("caches successes briefly, case-insensitively, and de-duplicates concurrent calls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const { client, requests } = setup(() => jsonResponse(repositoryFixture));
    const [a, b] = await Promise.all([
      fetchRepositorySummaryWith(client, "facebook", "react"),
      fetchRepositorySummaryWith(client, "Facebook", "React"),
    ]);
    expect(a).toEqual(b);
    a.stars = 0;
    expect((await fetchRepositorySummaryWith(client, "facebook", "react")).stars).toBe(239000);
    expect(requests).toHaveLength(1);
    vi.setSystemTime(Date.now() + SUMMARY_TTL_MS + 1);
    await fetchRepositorySummaryWith(client, "facebook", "react");
    expect(requests).toHaveLength(2);
  });

  it("remembers definitive failures briefly but retries transient ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const missing = setup(() => jsonResponse({ message: "Not Found" }, { status: 404 }));
    await expect(fetchRepositorySummaryWith(missing.client, "a", "b")).rejects.toBeInstanceOf(
      SourceError,
    );
    await expect(fetchRepositorySummaryWith(missing.client, "a", "b")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(missing.requests).toHaveLength(1);
    vi.setSystemTime(Date.now() + SUMMARY_ERROR_TTL_MS + 1);
    await expect(fetchRepositorySummaryWith(missing.client, "a", "b")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(missing.requests).toHaveLength(2);

    const flaky = setup(() => jsonResponse({}, { status: 500 }));
    await expect(fetchRepositorySummaryWith(flaky.client, "a", "b")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    await expect(fetchRepositorySummaryWith(flaky.client, "a", "b")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    expect(flaky.requests).toHaveLength(2);
  });
});

describe("quota reserved for analyses", () => {
  /** Answers every request with the given remaining quota (of 60, like an unauthenticated server). */
  function quotaSetup(remaining: () => number, status: () => number = () => 200) {
    return setup(() =>
      status() === 200
        ? jsonResponse(repositoryFixture, {
            headers: rateLimitHeaders({ limit: 60, remaining: remaining() }),
          })
        : jsonResponse({ message: "Server Error" }, { status: status() }),
    );
  }

  it("stops calling GitHub for summaries once half of the quota is left", async () => {
    const { client, requests } = quotaSetup(() => 29);
    expect(reservedQuotaError(client)).toBeNull();
    await fetchRepositorySummaryWith(client, "facebook", "react");
    expect(requests).toHaveLength(1);
    expect(reservedQuotaError(client)).toMatchObject({ code: "RATE_LIMITED" });

    // Made-up names cost nothing once the quota is reserved.
    for (const name of ["a1", "a2", "a3"]) {
      await expect(fetchRepositorySummaryWith(client, "someone", name)).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
    }
    expect(requests).toHaveLength(1);
  });

  it("serves the last known summary while the quota is reserved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    let remaining = 45;
    const { client, requests } = quotaSetup(() => remaining);
    const fresh = await fetchRepositorySummaryWith(client, "facebook", "react");
    // Another lookup brings the quota reading down to the reserve.
    remaining = 10;
    await fetchRepositorySummaryWith(client, "vercel", "ms");
    vi.setSystemTime(Date.now() + SUMMARY_TTL_MS + 1);
    expect(await fetchRepositorySummaryWith(client, "facebook", "react")).toEqual(fresh);
    expect(requests).toHaveLength(2);
  });

  it("serves the last known summary during an outage, for at most a day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    let status = 200;
    const { client, requests } = quotaSetup(
      () => 59,
      () => status,
    );
    const fresh = await fetchRepositorySummaryWith(client, "facebook", "react");
    status = 502;
    vi.setSystemTime(Date.now() + SUMMARY_TTL_MS + 1);
    expect(await fetchRepositorySummaryWith(client, "facebook", "react")).toEqual(fresh);
    expect(requests).toHaveLength(2);
    vi.setSystemTime(Date.now() + STALE_SUMMARY_MAX_AGE_MS);
    await expect(fetchRepositorySummaryWith(client, "facebook", "react")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("shares one metadata call between a summary and the snapshot of the same repository", async () => {
    const { client, requests } = setup((request) =>
      request.url.pathname.includes("/commits/")
        ? textResponse("c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00")
        : jsonResponse(repositoryFixture),
    );
    await fetchRepositorySummaryWith(client, "facebook", "react");
    const snapshot = await new GitHubSource({
      owner: "facebook",
      repo: "react",
      client,
    }).getSnapshot();
    expect(snapshot.repository.commitSha).toBe("c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00");
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/repos/facebook/react",
      "/repos/facebook/react/commits/main",
    ]);
  });
});

describe("GitHub provider entry point", () => {
  it("re-exports the source and client", () => {
    expect(ExportedClient).toBe(GitHubClient);
    expect(typeof GitHubSource).toBe("function");
  });

  it("creates one shared client per process with the trimmed GITHUB_TOKEN", () => {
    vi.stubEnv("GITHUB_TOKEN", "  ghp_shared  ");
    const client = getSharedGitHubClient();
    expect(getSharedGitHubClient()).toBe(client);
    expect(client.hasToken()).toBe(true);
    resetSharedClient();
    vi.stubEnv("GITHUB_TOKEN", "   ");
    expect(getSharedGitHubClient().hasToken()).toBe(false);
  });

  it("creates sources bound to the shared client and validates input", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const source = createGitHubSource({ owner: "facebook", repo: "react", ref: "main" });
    expect(source).toBeInstanceOf(GitHubSource);
    expect(source.capabilities).toEqual({ fileHistory: false, commitCounts: false });
    expect(() => createGitHubSource({ owner: "facebook", repo: "re/act" })).toThrowError(
      expect.objectContaining({ code: "INVALID_REPOSITORY" }),
    );
  });

  it("fetchRepositorySummary uses the shared client (global fetch, token only to the API)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_summary_token");
    const fake = createFakeFetch(() => jsonResponse(repositoryFixture));
    vi.stubGlobal("fetch", fake.fetch);
    const summary = await fetchRepositorySummary("facebook", "react");
    expect(summary.fullName).toBe("facebook/react");
    expect(fake.requests[0]?.url.href).toBe("https://api.github.com/repos/facebook/react");
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer ghp_summary_token");
  });
});
