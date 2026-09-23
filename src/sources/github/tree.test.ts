import { describe, expect, it } from "vitest";
import {
  createFakeFetch,
  jsonResponse,
  rateLimitHeaders,
  recordingSleep,
  type FakeHandler,
  type RecordedRequest,
} from "@/github/__fixtures__/fake-fetch";
import { SNAPSHOT_SHA, makeSnapshot, treeFixture } from "@/github/__fixtures__/github-fixtures";
import { GitHubClient } from "@/github/client";
import { GitHubSource } from "./github-source";
import { RECOVERY_MAX_SUBTREES } from "./tree";

type TreeItem = { path: string; type: string; mode?: string; sha?: string; size?: number };

function sha(seed: number): string {
  return seed.toString(16).padStart(40, "a");
}

function blob(path: string, size = 10): TreeItem {
  return { path, type: "blob", mode: "100644", sha: sha(path.length), size };
}

function dir(path: string, seed: number): TreeItem {
  return { path, type: "tree", mode: "040000", sha: sha(seed) };
}

function treeResponse(tree: TreeItem[], truncated = false, headers: Record<string, string> = {}) {
  return jsonResponse({ sha: SNAPSHOT_SHA, tree, truncated }, { headers });
}

function treeShaOf(request: RecordedRequest): string | undefined {
  return /\/git\/trees\/([0-9a-f]{40})$/.exec(request.url.pathname)?.[1];
}

function setup(
  handler: FakeHandler,
  options: { maxTreeEntries?: number; maxRetries?: number } = {},
) {
  const fake = createFakeFetch(handler);
  const client = new GitHubClient({
    fetchImpl: fake.fetch,
    sleep: recordingSleep().sleep,
    maxRetries: options.maxRetries ?? 0,
  });
  const source = new GitHubSource({
    owner: "facebook",
    repo: "react",
    client,
    maxTreeEntries: options.maxTreeEntries,
  });
  return { source, requests: fake.requests };
}

describe("GitHubSource.listTree", () => {
  it("maps blobs, symlinks and submodules, drops unsafe paths and sorts entries", async () => {
    const { source, requests } = setup(() => jsonResponse(treeFixture));
    const tree = await source.listTree(makeSnapshot());
    expect(tree).toEqual({
      entries: [
        { path: "Makefile", type: "file", size: 0 },
        { path: "README.md", type: "file", size: 1204 },
        { path: "docs/latest", type: "symlink", size: 12 },
        { path: "src/index.ts", type: "file", size: 3120 },
        { path: "src/util/format.ts", type: "file", size: 512 },
        { path: "vendor/lib", type: "submodule", size: 0 },
      ],
      truncated: false,
      rejectedEntries: 3,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.pathname).toBe(`/repos/facebook/react/git/trees/${SNAPSHOT_SHA}`);
    expect(requests[0]?.url.searchParams.get("recursive")).toBe("1");
  });

  it("stops at maxTreeEntries and reports truncation", async () => {
    const tree = Array.from({ length: 25 }, (_, index) =>
      blob(`f${String(index).padStart(2, "0")}.ts`),
    );
    const { source } = setup(() => treeResponse(tree), { maxTreeEntries: 10 });
    const result = await source.listTree(makeSnapshot());
    expect(result.entries).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("rejects invalid tree payloads", async () => {
    const { source } = setup(() => jsonResponse({ sha: SNAPSHOT_SHA, tree: [{ path: 1 }] }));
    await expect(source.listTree(makeSnapshot())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("GitHubSource.listTree truncation recovery", () => {
  const partial = [blob("README.md"), dir("src", 1), blob("src/a.ts"), dir("docs", 2)];
  const root = [
    blob("README.md"),
    dir("src", 1),
    dir("docs", 2),
    { path: "ext", type: "commit", sha: sha(9) },
  ];
  const subtrees: Record<string, TreeItem[]> = {
    [sha(1)]: [blob("a.ts"), blob("b.ts"), dir("lib", 3), blob("lib/c.ts")],
    [sha(2)]: [blob("guide.md")],
  };

  function recoveringHandler(
    overrides: { subtreeTruncated?: boolean; failSha?: string } = {},
  ): FakeHandler {
    return (request) => {
      const treeSha = treeShaOf(request);
      const recursive = request.url.searchParams.get("recursive") === "1";
      if (treeSha === SNAPSHOT_SHA)
        return recursive ? treeResponse(partial, true) : treeResponse(root);
      if (treeSha && treeSha === overrides.failSha) return jsonResponse({}, { status: 500 });
      if (treeSha && subtrees[treeSha])
        return treeResponse(subtrees[treeSha], overrides.subtreeTruncated);
      return jsonResponse({ message: "Not Found" }, { status: 404 });
    };
  }

  it("recovers the full listing from per-directory subtrees", async () => {
    const { source, requests } = setup(recoveringHandler());
    const tree = await source.listTree(makeSnapshot());
    expect(tree.truncated).toBe(false);
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "docs/guide.md",
      "ext",
      "src/a.ts",
      "src/b.ts",
      "src/lib/c.ts",
    ]);
    expect(tree.entries.find((entry) => entry.path === "ext")?.type).toBe("submodule");
    expect(requests).toHaveLength(4);
    expect(requests[1]?.url.searchParams.has("recursive")).toBe(false);
  });

  it("stays truncated when a subtree is itself truncated", async () => {
    const { source } = setup(recoveringHandler({ subtreeTruncated: true }));
    expect((await source.listTree(makeSnapshot())).truncated).toBe(true);
  });

  it("falls back to the original entries for directories that fail to load", async () => {
    const { source } = setup(recoveringHandler({ failSha: sha(1) }));
    const tree = await source.listTree(makeSnapshot());
    expect(tree.truncated).toBe(true);
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "docs/guide.md",
      "ext",
      "src/a.ts",
    ]);
  });

  it("skips recovery when the remaining quota is low", async () => {
    const { source, requests } = setup(() =>
      treeResponse(partial, true, rateLimitHeaders({ remaining: 50, reset: 1_900_000_000 })),
    );
    const tree = await source.listTree(makeSnapshot());
    expect(requests).toHaveLength(1);
    expect(tree.truncated).toBe(true);
    expect(tree.entries.map((entry) => entry.path)).toEqual(["README.md", "src/a.ts"]);
  });

  it("limits recovery to 60 subtrees with at most 4 in flight", async () => {
    const directories = Array.from({ length: 70 }, (_, index) => dir(`d${index}`, 100 + index));
    let active = 0;
    let peak = 0;
    const { source, requests } = setup(async (request) => {
      const treeSha = treeShaOf(request);
      if (treeSha === SNAPSHOT_SHA) {
        return request.url.searchParams.get("recursive") === "1"
          ? treeResponse([blob("x.ts")], true)
          : treeResponse(directories);
      }
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return treeResponse([blob("file.ts")]);
    });
    const tree = await source.listTree(makeSnapshot());
    expect(requests).toHaveLength(2 + RECOVERY_MAX_SUBTREES);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(tree.truncated).toBe(true);
    expect(tree.entries).toHaveLength(RECOVERY_MAX_SUBTREES + 1);
  });

  it("stops issuing subtree requests after a rate limit", async () => {
    const directories = Array.from({ length: 10 }, (_, index) => dir(`d${index}`, 200 + index));
    let subtreeRequests = 0;
    const { source } = setup((request) => {
      const treeSha = treeShaOf(request);
      if (treeSha === SNAPSHOT_SHA) {
        return request.url.searchParams.get("recursive") === "1"
          ? treeResponse([], true)
          : treeResponse(directories);
      }
      subtreeRequests += 1;
      return jsonResponse(
        {},
        { status: 403, headers: rateLimitHeaders({ remaining: 0, reset: 1_900_000_000 }) },
      );
    });
    const tree = await source.listTree(makeSnapshot());
    expect(tree.truncated).toBe(true);
    expect(subtreeRequests).toBeLessThanOrEqual(4);
  });

  it("propagates cancellation during recovery", async () => {
    const controller = new AbortController();
    const { source } = setup((request) => {
      const treeSha = treeShaOf(request);
      if (treeSha === SNAPSHOT_SHA && request.url.searchParams.get("recursive") === "1") {
        return treeResponse(partial, true);
      }
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(source.listTree(makeSnapshot(), controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
  });
});
