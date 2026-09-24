import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeFetch,
  jsonResponse,
  rateLimitHeaders,
  recordingSleep,
  textResponse,
  type FakeHandler,
} from "@/github/__fixtures__/fake-fetch";
import { makeSnapshot, repositoryFixture } from "@/github/__fixtures__/github-fixtures";
import { GitHubClient } from "@/github/client";
import { SourceError, type SourceSnapshot } from "@/sources/types";
import { GitHubSource, SNAPSHOT_TTL_MS } from "./github-source";

const HEAD_SHA = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";

interface ApiOptions {
  repository?: Record<string, unknown>;
  repositoryStatus?: number;
  refStatus?: number;
  refBody?: string;
}

function apiHandler(options: ApiOptions = {}): FakeHandler {
  return (request) => {
    const path = request.url.pathname;
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      if (options.repositoryStatus) {
        return jsonResponse({ message: "Not Found" }, { status: options.repositoryStatus });
      }
      return jsonResponse(
        { ...repositoryFixture, ...options.repository },
        { headers: { etag: '"repo-v1"', ...rateLimitHeaders({ remaining: 4999 }) } },
      );
    }
    if (/^\/repos\/[^/]+\/[^/]+\/commits\/.+/.test(path)) {
      if (options.refStatus) {
        return jsonResponse({ message: "No commit found" }, { status: options.refStatus });
      }
      return textResponse(options.refBody ?? HEAD_SHA);
    }
    return jsonResponse({ message: "unexpected" }, { status: 500 });
  };
}

function setup(options: ApiOptions = {}, token?: string) {
  const fake = createFakeFetch(apiHandler(options));
  const client = new GitHubClient({ fetchImpl: fake.fetch, token, sleep: recordingSleep().sleep });
  return { client, requests: fake.requests };
}

async function snapshotError(source: GitHubSource): Promise<SourceError> {
  const error = await source.getSnapshot().catch((e: unknown) => e);
  if (!(error instanceof SourceError)) throw new Error("expected a SourceError");
  return error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GitHubSource.getSnapshot", () => {
  it("maps repository metadata and pins the default branch head", async () => {
    const { client, requests } = setup();
    const source = new GitHubSource({ owner: "facebook", repo: "react", client });
    const snapshot = await source.getSnapshot();
    expect(snapshot.repository).toEqual({
      id: "github:facebook/react",
      provider: "github",
      owner: "facebook",
      name: "react",
      fullName: "facebook/react",
      description: "The library for web and native user interfaces.",
      url: "https://github.com/facebook/react",
      defaultBranch: "main",
      ref: "main",
      commitSha: HEAD_SHA,
      stars: 239000,
      forks: 49500,
      watchers: 6700,
      openIssues: 1024,
      language: "JavaScript",
      topics: ["declarative", "frontend", "javascript", "library", "react", "ui"],
      license: "MIT",
      homepage: "https://react.dev/",
      createdAt: "2013-05-24T16:15:54.000Z",
      pushedAt: "2026-09-22T18:31:07.000Z",
      sizeKb: 1034567,
      isFork: false,
      isArchived: false,
    });
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/repos/facebook/react",
      "/repos/facebook/react/commits/main",
    ]);
    expect(requests[1]?.headers.accept).toBe("application/vnd.github.sha");
  });

  it("resolves a requested ref, including refs with slashes", async () => {
    const { client, requests } = setup();
    const snapshot = await new GitHubSource({
      owner: "facebook",
      repo: "react",
      ref: "release/v19.1",
      client,
    }).getSnapshot();
    expect(snapshot.repository.ref).toBe("release/v19.1");
    expect(snapshot.repository.commitSha).toBe(HEAD_SHA);
    expect(requests[1]?.url.pathname).toBe("/repos/facebook/react/commits/release/v19.1");
  });

  it("uses the canonical owner/name casing from the API", async () => {
    const { client, requests } = setup();
    const snapshot = await new GitHubSource({
      owner: "FaceBook",
      repo: "React",
      client,
    }).getSnapshot();
    expect(snapshot.repository.fullName).toBe("facebook/react");
    expect(requests[1]?.url.pathname).toBe("/repos/facebook/react/commits/main");
  });

  it.each([
    [{ private: true }],
    [{ visibility: "internal" }],
    [{ visibility: "private", private: false }],
  ])("rejects non-public repositories %j before resolving the ref", async (repository) => {
    const { client, requests } = setup({ repository });
    const error = await snapshotError(
      new GitHubSource({ owner: "facebook", repo: "react", client }),
    );
    expect(error.code).toBe("PRIVATE_OR_INACCESSIBLE");
    expect(requests).toHaveLength(1);
  });

  it.each([
    [404, "v0.0.0-missing", "REF_NOT_FOUND"],
    [422, "deadbeef", "REF_NOT_FOUND"],
    [404, undefined, "EMPTY_REPOSITORY"],
    [422, undefined, "EMPTY_REPOSITORY"],
    [409, undefined, "EMPTY_REPOSITORY"],
    [409, "main", "EMPTY_REPOSITORY"],
  ] as const)("maps ref resolution HTTP %i (ref %j) to %s", async (refStatus, ref, code) => {
    const { client } = setup({ refStatus });
    const error = await snapshotError(
      new GitHubSource({ owner: "facebook", repo: "react", ref, client }),
    );
    expect(error.code).toBe(code);
    expect(error.status).toBe(refStatus);
  });

  it("reports a missing repository as NOT_FOUND", async () => {
    const { client } = setup({ repositoryStatus: 404 });
    expect(
      (await snapshotError(new GitHubSource({ owner: "nobody", repo: "nothing", client }))).code,
    ).toBe("NOT_FOUND");
  });

  it("rejects a malformed SHA answer", async () => {
    const { client } = setup({ refBody: "<html>not a sha</html>" });
    expect(
      (await snapshotError(new GitHubSource({ owner: "facebook", repo: "react", client }))).code,
    ).toBe("INVALID_RESPONSE");
  });

  it("rejects malformed repository names from the API", async () => {
    const { client } = setup({ repository: { full_name: "facebook/react/extra" } });
    expect(
      (await snapshotError(new GitHubSource({ owner: "facebook", repo: "react", client }))).code,
    ).toBe("INVALID_RESPONSE");
  });

  it("sanitizes untrusted metadata fields", async () => {
    const { client } = setup({
      repository: {
        description: "  Line one\u0000\nline two  ",
        homepage: "javascript:alert(1)",
        license: { spdx_id: "NOASSERTION" },
        topics: ["ok-topic", "Bad Topic", "<script>"],
        subscribers_count: undefined,
        watchers_count: 12,
        language: null,
      },
    });
    const { repository } = await new GitHubSource({
      owner: "facebook",
      repo: "react",
      client,
    }).getSnapshot();
    expect(repository.description).toBe("Line one line two");
    expect(repository.homepage).toBeUndefined();
    expect(repository.license).toBeUndefined();
    expect(repository.topics).toEqual(["ok-topic"]);
    expect(repository.watchers).toBe(12);
    expect(repository.language).toBeUndefined();
  });

  it("accepts scheme-less homepages as https", async () => {
    const { client } = setup({ repository: { homepage: "react.dev" } });
    const { repository } = await new GitHubSource({
      owner: "facebook",
      repo: "react",
      client,
    }).getSnapshot();
    expect(repository.homepage).toBe("https://react.dev/");
  });

  it("caches snapshots per (owner, repo, ref) for 60 seconds and returns clones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const { client, requests } = setup();
    const first = await new GitHubSource({
      owner: "facebook",
      repo: "react",
      client,
    }).getSnapshot();
    first.repository.stars = -1;
    const second = await new GitHubSource({
      owner: "FACEBOOK",
      repo: "react",
      client,
    }).getSnapshot();
    expect(second.repository.stars).toBe(239000);
    expect(requests).toHaveLength(2);

    // Another ref reuses the metadata loaded moments ago: only the ref is resolved.
    await new GitHubSource({
      owner: "facebook",
      repo: "react",
      ref: "v18.2.0",
      client,
    }).getSnapshot();
    expect(requests).toHaveLength(3);

    vi.setSystemTime(Date.now() + SNAPSHOT_TTL_MS + 1);
    await new GitHubSource({ owner: "facebook", repo: "react", client }).getSnapshot();
    expect(requests).toHaveLength(5);
    // The metadata call was conditional thanks to the ETag cache.
    expect(requests[3]?.headers["if-none-match"]).toBe('"repo-v1"');
  });

  it("de-duplicates concurrent snapshot resolution", async () => {
    const { client, requests } = setup();
    const source = new GitHubSource({ owner: "facebook", repo: "react", client });
    const [a, b] = await Promise.all([source.getSnapshot(), source.getSnapshot()]);
    expect(a).toEqual(b);
    expect(requests).toHaveLength(2);
  });

  it("stops waiting when the caller aborts", async () => {
    const { client } = setup();
    const source = new GitHubSource({ owner: "facebook", repo: "react", client });
    await expect(source.getSnapshot(AbortSignal.abort())).rejects.toMatchObject({
      code: "ABORTED",
    });
  });
});

describe("GitHubSource construction and delegation", () => {
  it.each([
    [{ owner: "evil.example/x", repo: "r" }],
    [{ owner: "o", repo: "../../x" }],
    [{ owner: "o", repo: "r", ref: "a..b" }],
    [{ owner: "o", repo: "r", ref: "--upload-pack=x y" }],
  ])("rejects malformed input %j with INVALID_REPOSITORY", (input) => {
    const client = new GitHubClient({ fetchImpl: createFakeFetch(apiHandler()).fetch });
    expect(() => new GitHubSource({ ...input, client })).toThrowError(
      expect.objectContaining({ code: "INVALID_REPOSITORY" }),
    );
  });

  it("advertises GraphQL capabilities only with a token", () => {
    const withToken = new GitHubSource({
      owner: "o",
      repo: "r",
      client: new GitHubClient({ token: "t" }),
    });
    const without = new GitHubSource({ owner: "o", repo: "r", client: new GitHubClient() });
    expect(withToken.provider).toBe("github");
    expect(withToken.capabilities).toEqual({ fileHistory: true, commitCounts: true });
    expect(without.capabilities).toEqual({ fileHistory: false, commitCounts: false });
  });

  it("reads files through the raw host at the snapshot commit", async () => {
    const fake = createFakeFetch(() => textResponse("hello"));
    const client = new GitHubClient({ fetchImpl: fake.fetch, token: "secret-token" });
    const source = new GitHubSource({ owner: "facebook", repo: "react", client });
    const snapshot = makeSnapshot();
    await expect(source.readFile(snapshot, "src/index.ts", { maxBytes: 100 })).resolves.toEqual({
      kind: "text",
      content: "hello",
      size: 5,
    });
    expect(fake.requests[0]?.url.href).toBe(
      `https://raw.githubusercontent.com/facebook/react/${snapshot.repository.commitSha}/src/index.ts`,
    );
    expect(fake.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("reports unsafe paths as missing without a request", async () => {
    const fake = createFakeFetch(() => textResponse("x"));
    const source = new GitHubSource({
      owner: "o",
      repo: "r",
      client: new GitHubClient({ fetchImpl: fake.fetch }),
    });
    await expect(
      source.readFile(makeSnapshot(), "../../etc/passwd", { maxBytes: 10 }),
    ).resolves.toEqual({
      kind: "missing",
    });
    expect(fake.requests).toHaveLength(0);
  });

  it("rejects snapshots with invalid coordinates", async () => {
    const source = new GitHubSource({ owner: "o", repo: "r", client: new GitHubClient() });
    const bad: SourceSnapshot = makeSnapshot({ commitSha: "main" });
    await expect(source.listTree(bad)).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
    await expect(source.readFile(bad, "a.ts", { maxBytes: 1 })).rejects.toMatchObject({
      code: "INVALID_REPOSITORY",
    });
  });

  it("delegates getRateLimit to the client", async () => {
    const { client } = setup();
    const source = new GitHubSource({ owner: "facebook", repo: "react", client });
    expect(source.getRateLimit()).toBeUndefined();
    await source.getSnapshot();
    expect(source.getRateLimit()?.remaining).toBe(4999);
  });
});
