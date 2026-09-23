import { describe, expect, it } from "vitest";
import {
  createFakeFetch,
  emptyResponse,
  jsonResponse,
  recordingSleep,
  type FakeHandler,
} from "@/github/__fixtures__/fake-fetch";
import {
  SNAPSHOT_SHA,
  commitDetailsFixture,
  commitFixture,
  contributorsFixture,
  makeCommitPayload,
  makeSnapshot,
} from "@/github/__fixtures__/github-fixtures";
import { GitHubClient } from "@/github/client";
import { GitHubSource } from "./github-source";
import { allowlistAvatarUrl, profileUrlFor, validLogin } from "./history";

function setup(handler: FakeHandler) {
  const fake = createFakeFetch(handler);
  const client = new GitHubClient({
    fetchImpl: fake.fetch,
    sleep: recordingSleep().sleep,
    maxRetries: 0,
  });
  return {
    source: new GitHubSource({ owner: "facebook", repo: "react", client }),
    requests: fake.requests,
  };
}

function pagedCommits(total: number): FakeHandler {
  return (request) => {
    const page = Number(request.url.searchParams.get("page"));
    const perPage = Number(request.url.searchParams.get("per_page"));
    const start = (page - 1) * perPage;
    const count = Math.max(0, Math.min(perPage, total - start));
    return jsonResponse(
      Array.from({ length: count }, (_, index) => makeCommitPayload(start + index + 1)),
    );
  };
}

describe("GitHubSource.listCommits", () => {
  it("paginates 100 at a time from the snapshot commit until maxCommits", async () => {
    const { source, requests } = setup(pagedCommits(1_000));
    const commits = await source.listCommits(makeSnapshot(), { maxCommits: 250 });
    expect(commits).toHaveLength(250);
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.url.searchParams.get("page"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    for (const request of requests) {
      expect(request.url.pathname).toBe("/repos/facebook/react/commits");
      expect(request.url.searchParams.get("sha")).toBe(SNAPSHOT_SHA);
      expect(request.url.searchParams.get("per_page")).toBe("100");
    }
    expect(commits[0]?.sha).toBe(makeCommitPayload(1).sha);
    expect(commits[249]?.sha).toBe(makeCommitPayload(250).sha);
  });

  it("stops on a short page", async () => {
    const { source, requests } = setup(pagedCommits(130));
    const commits = await source.listCommits(makeSnapshot(), { maxCommits: 300 });
    expect(commits).toHaveLength(130);
    expect(requests).toHaveLength(2);
  });

  it("makes no request for maxCommits 0", async () => {
    const { source, requests } = setup(pagedCommits(10));
    expect(await source.listCommits(makeSnapshot(), { maxCommits: 0 })).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("maps commit payloads to the model", async () => {
    const { source } = setup(() => jsonResponse([commitFixture]));
    const [commit] = await source.listCommits(makeSnapshot(), { maxCommits: 10 });
    expect(commit).toEqual({
      sha: "6f2c1a9e0b3d4c5e6f7a8b9c0d1e2f3a4b5c6d7e",
      message: "Fix scheduler starvation under load",
      authorName: "Ada Lovelace",
      authorLogin: "ada",
      authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      date: "2026-09-20T12:34:56.000Z",
      url: "https://github.com/facebook/react/commit/6f2c1a9e0b3d4c5e6f7a8b9c0d1e2f3a4b5c6d7e",
    });
  });

  it("falls back for missing author data and drops invalid commits", async () => {
    const payloads = [
      makeCommitPayload(1, {
        commit: { message: "no name", author: { name: null, date: "2026-01-01T00:00:00Z" } },
        author: { login: "octocat", avatar_url: "https://evil.example/a.png" },
      }),
      makeCommitPayload(2, {
        commit: { message: "anonymous", author: null, committer: { date: "2026-01-02T00:00:00Z" } },
        author: null,
      }),
      makeCommitPayload(3, { sha: "not-a-sha" }),
      makeCommitPayload(4, { commit: { message: "no date", author: { name: "x" } } }),
      makeCommitPayload(5, {
        commit: {
          message: `${"long ".repeat(100)}\nbody`,
          author: { name: "  Eve\u0007 ", date: "2026-01-03T00:00:00Z" },
        },
        author: { login: "bad login!" },
        html_url: "javascript:alert(1)",
      }),
    ];
    const { source } = setup(() => jsonResponse(payloads));
    const commits = await source.listCommits(makeSnapshot(), { maxCommits: 10 });
    expect(commits).toHaveLength(3);
    expect(commits[0]).toMatchObject({ authorName: "octocat", authorLogin: "octocat" });
    expect(commits[0]?.authorAvatarUrl).toBeUndefined();
    expect(commits[1]).toMatchObject({ authorName: "Unknown", date: "2026-01-02T00:00:00.000Z" });
    expect(commits[1]?.authorLogin).toBeUndefined();
    expect(commits[2]?.authorName).toBe("Eve");
    expect(commits[2]?.authorLogin).toBeUndefined();
    expect(commits[2]?.message.length).toBeLessThanOrEqual(300);
    expect(commits[2]?.url).toBe(
      `https://github.com/facebook/react/commit/${makeCommitPayload(5).sha}`,
    );
  });
});

describe("GitHubSource.getCommitDetails", () => {
  it("returns sanitized, de-duplicated changed files and line stats", async () => {
    const { source, requests } = setup(() => jsonResponse(commitDetailsFixture));
    const details = await source.getCommitDetails(makeSnapshot(), commitDetailsFixture.sha);
    expect(requests[0]?.url.pathname).toBe(
      `/repos/facebook/react/commits/${commitDetailsFixture.sha}`,
    );
    expect(details).toMatchObject({
      sha: commitDetailsFixture.sha,
      message: "Fix scheduler starvation under load",
      additions: 30,
      deletions: 12,
      files: [
        "packages/scheduler/src/Scheduler.js",
        "packages/scheduler/src/__tests__/Scheduler-test.js",
      ],
    });
  });

  it("rejects non-SHA input before any request", async () => {
    const { source, requests } = setup(() => jsonResponse(commitDetailsFixture));
    await expect(source.getCommitDetails(makeSnapshot(), "HEAD~1")).rejects.toMatchObject({
      code: "INVALID_REPOSITORY",
    });
    expect(requests).toHaveLength(0);
  });

  it("maps a missing commit to NOT_FOUND", async () => {
    const { source } = setup(() => jsonResponse({ message: "No commit found" }, { status: 422 }));
    await expect(source.getCommitDetails(makeSnapshot(), "f".repeat(40))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("GitHubSource.listContributors", () => {
  it("maps contributors with constructed profile URLs and allowlisted avatars", async () => {
    const { source, requests } = setup(() => jsonResponse(contributorsFixture));
    const contributors = await source.listContributors(makeSnapshot());
    expect(contributors).toEqual([
      {
        login: "gaearon",
        name: "gaearon",
        profileUrl: "https://github.com/gaearon",
        avatarUrl: "https://avatars.githubusercontent.com/u/810438?v=4",
        contributions: 1850,
      },
      {
        login: "sebmarkbage",
        name: "sebmarkbage",
        profileUrl: "https://github.com/sebmarkbage",
        avatarUrl: "https://avatars.githubusercontent.com/u/63648?v=4",
        contributions: 1600,
      },
      {
        login: "dependabot[bot]",
        name: "dependabot[bot]",
        profileUrl: "https://github.com/apps/dependabot",
        avatarUrl: "https://avatars.githubusercontent.com/in/29110?v=4",
        contributions: 120,
      },
      {
        login: "tracker",
        name: "tracker",
        profileUrl: "https://github.com/tracker",
        contributions: 7,
      },
    ]);
    const url = requests[0]?.url;
    expect(url?.pathname).toBe("/repos/facebook/react/contributors");
    expect(url?.searchParams.get("per_page")).toBe("100");
    expect(url?.searchParams.has("anon")).toBe(false);
  });

  it("treats 204 (statistics being computed) as no contributors", async () => {
    const { source } = setup(() => emptyResponse(204));
    await expect(source.listContributors(makeSnapshot())).resolves.toEqual([]);
  });

  it("treats GitHub's 'too large to list' 403 as no contributors", async () => {
    const { source } = setup(() =>
      jsonResponse(
        {
          message:
            "The history or contributor list is too large to list contributors for this repository via the API.",
        },
        { status: 403 },
      ),
    );
    await expect(source.listContributors(makeSnapshot())).resolves.toEqual([]);
  });

  it("propagates other 403s", async () => {
    const { source } = setup(() => jsonResponse({ message: "Forbidden" }, { status: 403 }));
    await expect(source.listContributors(makeSnapshot())).rejects.toMatchObject({
      code: "PRIVATE_OR_INACCESSIBLE",
    });
  });

  it("uses conditional requests for repeated lookups", async () => {
    const { source, requests } = setup((request) =>
      request.headers["if-none-match"] === '"c1"'
        ? emptyResponse(304)
        : jsonResponse(contributorsFixture, { headers: { etag: '"c1"' } }),
    );
    const first = await source.listContributors(makeSnapshot());
    const second = await source.listContributors(makeSnapshot());
    expect(second).toEqual(first);
    expect(requests[1]?.headers["if-none-match"]).toBe('"c1"');
  });
});

describe("history helpers", () => {
  it("allowlists only GitHub avatar CDN URLs", () => {
    expect(allowlistAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4",
    );
    expect(allowlistAvatarUrl("http://avatars.githubusercontent.com/u/1")).toBeUndefined();
    expect(
      allowlistAvatarUrl("https://avatars.githubusercontent.com.evil.example/u/1"),
    ).toBeUndefined();
    expect(
      allowlistAvatarUrl("https://evil.example/https://avatars.githubusercontent.com/"),
    ).toBeUndefined();
    expect(allowlistAvatarUrl(null)).toBeUndefined();
  });

  it("validates logins and builds profile URLs", () => {
    expect(validLogin("octo-cat")).toBe("octo-cat");
    expect(validLogin("renovate[bot]")).toBe("renovate[bot]");
    expect(validLogin("../x")).toBeUndefined();
    expect(validLogin("a".repeat(40))).toBeUndefined();
    expect(profileUrlFor("octo-cat")).toBe("https://github.com/octo-cat");
    expect(profileUrlFor("renovate[bot]")).toBe("https://github.com/apps/renovate");
  });
});
