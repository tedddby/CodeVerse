import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeFetch, jsonResponse, type FakeHandler } from "@/github/__fixtures__/fake-fetch";
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
import { SUMMARY_ERROR_TTL_MS, SUMMARY_TTL_MS, fetchRepositorySummaryWith } from "./summary";

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
