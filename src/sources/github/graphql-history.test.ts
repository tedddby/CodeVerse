import { describe, expect, it } from "vitest";
import {
  createFakeFetch,
  jsonResponse,
  recordingSleep,
  type FakeHandler,
  type RecordedRequest,
} from "@/github/__fixtures__/fake-fetch";
import { SNAPSHOT_SHA, makeSnapshot } from "@/github/__fixtures__/github-fixtures";
import { GitHubClient } from "@/github/client";
import { GitHubSource } from "./github-source";
import {
  COMMIT_COUNT_BATCH_SIZE,
  FILE_ACTIVITY_BATCH_SIZE,
  buildCommitCountQuery,
  buildFileActivityQuery,
} from "./graphql-history";

const TOKEN = "ghp_GRAPHQL_TEST_TOKEN_value";

interface GraphqlBody {
  query: string;
  variables: Record<string, unknown>;
}

function bodyOf(request: RecordedRequest): GraphqlBody {
  return JSON.parse(request.body ?? "{}") as GraphqlBody;
}

function setup(handler: FakeHandler, token: string | null = TOKEN) {
  const fake = createFakeFetch(handler);
  const client = new GitHubClient({
    fetchImpl: fake.fetch,
    token: token ?? undefined,
    sleep: recordingSleep().sleep,
    maxRetries: 0,
  });
  return {
    source: new GitHubSource({ owner: "facebook", repo: "react", client }),
    requests: fake.requests,
  };
}

/** Answers file-activity queries: every path gets a commit unless it contains "untracked". */
function activityHandler(onRequest?: (body: GraphqlBody) => Response | undefined): FakeHandler {
  return (request) => {
    const body = bodyOf(request);
    const override = onRequest?.(body);
    if (override) return override;
    const object: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.variables)) {
      const match = /^p(\d+)$/.exec(key);
      if (!match) continue;
      const path = String(value);
      object[`f${match[1]}`] = path.includes("untracked")
        ? { nodes: [] }
        : {
            nodes: [
              {
                committedDate: "2026-09-01T10:00:00Z",
                author: { name: `Author of ${path}`, user: { login: "octocat" } },
              },
            ],
          };
    }
    return jsonResponse({ data: { repository: { object } } });
  };
}

describe("GitHubSource.getFileActivity", () => {
  it("batches paths as GraphQL variables and never interpolates them into the query", async () => {
    const hostile = 'evil") { __typename } mutation { x } #';
    const paths = [
      ...Array.from({ length: 93 }, (_, index) => `src/file-${index}.ts`),
      "docs/untracked.md",
      hostile,
    ];
    const { source, requests } = setup(activityHandler());
    const activity = await source.getFileActivity(makeSnapshot(), paths);

    expect(requests).toHaveLength(3);
    const bodies = requests.map(bodyOf);
    expect(
      bodies.map((body) => Object.keys(body.variables).filter((key) => /^p\d+$/.test(key)).length),
    ).toEqual([40, 40, 15]);
    for (const body of bodies) {
      for (const path of paths) expect(body.query).not.toContain(path);
      expect(body.query).not.toContain("src/");
      expect(body.variables).toMatchObject({ owner: "facebook", name: "react", oid: SNAPSHOT_SHA });
    }
    expect(bodies[2]?.variables.p14).toBe(hostile);

    expect(activity.size).toBe(94);
    expect(activity.has("docs/untracked.md")).toBe(false);
    expect(activity.get("src/file-0.ts")).toEqual({
      lastModified: "2026-09-01T10:00:00.000Z",
      authorLogin: "octocat",
      authorName: "Author of src/file-0.ts",
    });
  });

  it("drops unsafe paths and duplicates before querying", async () => {
    const { source, requests } = setup(activityHandler());
    const activity = await source.getFileActivity(makeSnapshot(), [
      "a.ts",
      "a.ts",
      "../x",
      "/abs",
      "",
    ]);
    expect(requests).toHaveLength(1);
    expect(bodyOf(requests[0] as RecordedRequest).variables).not.toHaveProperty("p1");
    expect([...activity.keys()]).toEqual(["a.ts"]);
  });

  it("runs at most two batches concurrently", async () => {
    let active = 0;
    let peak = 0;
    const inner = activityHandler();
    const { source } = setup(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return inner(request);
    });
    const paths = Array.from(
      { length: FILE_ACTIVITY_BATCH_SIZE * 5 },
      (_, index) => `f${index}.ts`,
    );
    const activity = await source.getFileActivity(makeSnapshot(), paths);
    expect(activity.size).toBe(paths.length);
    expect(peak).toBe(2);
  });

  it("skips a failing later batch and keeps the others", async () => {
    let call = 0;
    const { source } = setup(
      activityHandler(() => {
        call += 1;
        return call === 2 ? jsonResponse({ message: "boom" }, { status: 502 }) : undefined;
      }),
    );
    const paths = Array.from({ length: 100 }, (_, index) => `f${index}.ts`);
    const activity = await source.getFileActivity(makeSnapshot(), paths);
    expect(activity.size).toBe(60);
  });

  it("throws when the first batch is rate limited", async () => {
    const { source } = setup(() =>
      jsonResponse({
        data: null,
        errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
      }),
    );
    await expect(source.getFileActivity(makeSnapshot(), ["a.ts"])).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("throws when the token is rejected on the first batch", async () => {
    const { source } = setup(() => jsonResponse({ message: "Bad credentials" }, { status: 401 }));
    await expect(source.getFileActivity(makeSnapshot(), ["a.ts"])).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("stops sending batches after a later rate limit instead of throwing", async () => {
    let call = 0;
    const { source, requests } = setup(
      activityHandler(() => {
        call += 1;
        return call >= 2
          ? jsonResponse({ data: null, errors: [{ type: "RATE_LIMITED", message: "limit" }] })
          : undefined;
      }),
    );
    const paths = Array.from(
      { length: FILE_ACTIVITY_BATCH_SIZE * 6 },
      (_, index) => `f${index}.ts`,
    );
    const activity = await source.getFileActivity(makeSnapshot(), paths);
    expect(activity.size).toBe(FILE_ACTIVITY_BATCH_SIZE);
    expect(requests.length).toBeLessThanOrEqual(3);
  });

  it("requires a token", async () => {
    const { source, requests } = setup(activityHandler(), null);
    await expect(source.getFileActivity(makeSnapshot(), ["a.ts"])).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(requests).toHaveLength(0);
  });

  it("honours cancellation", async () => {
    const { source } = setup(activityHandler());
    await expect(
      source.getFileActivity(makeSnapshot(), ["a.ts"], AbortSignal.abort()),
    ).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("returns an empty map for no paths without a request", async () => {
    const { source, requests } = setup(activityHandler());
    expect((await source.getFileActivity(makeSnapshot(), [])).size).toBe(0);
    expect(requests).toHaveLength(0);
  });
});

describe("GitHubSource.getCommitCounts", () => {
  function countHandler(): FakeHandler {
    return (request) => {
      const body = bodyOf(request);
      const object: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.variables)) {
        const match = /^s(\d+)$/.exec(key);
        if (match)
          object[`c${match[1]}`] = { totalCount: new Date(String(value)).getUTCMonth() + 1 };
      }
      return jsonResponse({ data: { repository: { object } } });
    };
  }

  function monthlyRanges(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      start: new Date(Date.UTC(2000, index, 1)).toISOString(),
      end: new Date(Date.UTC(2000, index + 1, 1)).toISOString(),
    }));
  }

  it("batches ranges, passes timestamps as variables and preserves input order", async () => {
    const { source, requests } = setup(countHandler());
    const ranges = monthlyRanges(120);
    const buckets = await source.getCommitCounts(makeSnapshot(), ranges);
    expect(requests).toHaveLength(Math.ceil(120 / COMMIT_COUNT_BATCH_SIZE));
    expect(buckets).toHaveLength(120);
    buckets.forEach((bucket, index) => {
      expect(bucket.start).toBe(ranges[index]?.start);
      expect(bucket.end).toBe(ranges[index]?.end);
      expect(bucket.commits).toBe((index % 12) + 1);
    });
    const first = bodyOf(requests[0] as RecordedRequest);
    expect(first.variables.s0).toBe("2000-01-01T00:00:00.000Z");
    // The end is exclusive: one second before the next bucket starts.
    expect(first.variables.u0).toBe("2000-01-31T23:59:59.000Z");
    expect(first.query).not.toContain("2000-");
  });

  it("answers invalid ranges with zero commits without querying them", async () => {
    const { source, requests } = setup(countHandler());
    const buckets = await source.getCommitCounts(makeSnapshot(), [
      { start: "garbage", end: "2000-01-01T00:00:00Z" },
      { start: "2000-02-01T00:00:00Z", end: "2000-01-01T00:00:00Z" },
    ]);
    expect(buckets.map((bucket) => bucket.commits)).toEqual([0, 0]);
    expect(requests).toHaveLength(0);
  });

  it("fails as a whole when a batch fails", async () => {
    const { source } = setup(() => jsonResponse({ message: "boom" }, { status: 502 }));
    await expect(source.getCommitCounts(makeSnapshot(), monthlyRanges(3))).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("fails on incomplete answers", async () => {
    const { source } = setup(() =>
      jsonResponse({ data: { repository: { object: { c0: { totalCount: 1 } } } } }),
    );
    await expect(source.getCommitCounts(makeSnapshot(), monthlyRanges(2))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("maps a missing snapshot commit to NOT_FOUND", async () => {
    const { source } = setup(() => jsonResponse({ data: { repository: { object: null } } }));
    await expect(source.getCommitCounts(makeSnapshot(), monthlyRanges(1))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("query builders", () => {
  it("only reference indexed variables", () => {
    const activity = buildFileActivityQuery(3);
    expect(activity).toMatch(/^query CodeVerseFileActivity\(/);
    expect(activity).toContain("$p2:String!");
    expect(activity).toContain("f2:history(first:1,path:$p2)");
    expect(activity).not.toContain("$p3");

    const counts = buildCommitCountQuery(2);
    expect(counts).toContain("$s1:GitTimestamp!,$u1:GitTimestamp!");
    expect(counts).toContain("c1:history(since:$s1,until:$u1){totalCount}");
  });
});
