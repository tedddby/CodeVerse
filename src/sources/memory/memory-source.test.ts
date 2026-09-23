import { describe, expect, it } from "vitest";
import type { SourceCommitDetails } from "@/sources/types";
import { MemorySource, type MemorySourceSpec } from "./memory-source";

const BOM = String.fromCharCode(0xfeff);

const commits: SourceCommitDetails[] = [
  {
    sha: "c".repeat(40),
    message: "Third",
    authorName: "Grace Hopper",
    authorLogin: "grace",
    date: "2026-03-10T00:00:00.000Z",
    url: "https://github.com/acme/app/commit/ccc",
    files: ["src/app.ts", "README.md", "../escape"],
    additions: 5,
    deletions: 1,
  },
  {
    sha: "b".repeat(40),
    message: "Second",
    authorName: "Alan Turing",
    date: "2026-02-15T00:00:00.000Z",
    url: "https://github.com/acme/app/commit/bbb",
    files: ["src/app.ts", "src/util.ts"],
  },
  {
    sha: "a".repeat(40),
    message: "First",
    authorName: "Grace H.",
    authorLogin: "Grace",
    date: "2026-01-05T00:00:00.000Z",
    url: "https://github.com/acme/app/commit/aaa",
    files: ["README.md", "src/util.ts", "docs/guide.md"],
  },
];

function spec(overrides: Partial<MemorySourceSpec> = {}): MemorySourceSpec {
  return {
    repository: { owner: "acme", name: "app" },
    files: {
      "src/app.ts": "export const app = 1;\n",
      "src/util.ts": `${BOM}export function util() {}\n`,
      "README.md": "# Äpp\n",
      "assets/logo.png": { binary: true, size: 2048 },
      "assets/icon.ico": { binary: true },
      "data/broken.json": { unreadable: true, size: 99 },
      "src/../escape.ts": "nope",
      "/abs.ts": "nope",
    },
    commits,
    ...overrides,
  };
}

describe("MemorySource snapshot and tree", () => {
  it("builds a deterministic snapshot with a valid 40-hex commit SHA", async () => {
    const source = new MemorySource(spec());
    const { repository } = await source.getSnapshot();
    expect(source.provider).toBe("local");
    expect(repository).toMatchObject({
      id: "local:acme/app",
      provider: "local",
      owner: "acme",
      name: "app",
      fullName: "acme/app",
      defaultBranch: "main",
      ref: "main",
      stars: 0,
      forks: 0,
      topics: [],
    });
    expect(repository.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const again = await new MemorySource(spec()).getSnapshot();
    expect(again.repository.commitSha).toBe(repository.commitSha);
    const changed = await new MemorySource(
      spec({ files: { ...spec().files, "src/app.ts": "export const app = 2;\n" } }),
    ).getSnapshot();
    expect(changed.repository.commitSha).not.toBe(repository.commitSha);
  });

  it("honours repository overrides", async () => {
    const source = new MemorySource(
      spec({
        repository: {
          owner: "acme",
          name: "app",
          provider: "github",
          ref: "v1.0.0",
          commitSha: "f".repeat(40),
          stars: 12,
        },
      }),
    );
    const { repository } = await source.getSnapshot();
    expect(source.provider).toBe("github");
    expect(repository).toMatchObject({
      id: "github:acme/app",
      url: "https://github.com/acme/app",
      ref: "v1.0.0",
      commitSha: "f".repeat(40),
      stars: 12,
    });
  });

  it("returns snapshot copies", async () => {
    const source = new MemorySource(spec());
    const first = await source.getSnapshot();
    first.repository.topics.push("mutated");
    expect((await source.getSnapshot()).repository.topics).toEqual([]);
  });

  it("lists a sorted, sanitized tree with UTF-8 byte sizes", async () => {
    const source = new MemorySource(spec({ truncated: true }));
    const tree = await source.listTree(await source.getSnapshot());
    expect(tree.entries).toEqual([
      { path: "README.md", type: "file", size: 7 },
      { path: "assets/icon.ico", type: "file", size: 1024 },
      { path: "assets/logo.png", type: "file", size: 2048 },
      { path: "data/broken.json", type: "file", size: 99 },
      { path: "src/app.ts", type: "file", size: 22 },
      { path: "src/util.ts", type: "file", size: 29 },
    ]);
    expect(tree.truncated).toBe(true);
    expect(tree.rejectedEntries).toBe(2);
  });
});

describe("MemorySource.readFile", () => {
  const source = new MemorySource(spec());

  it("returns text content, stripping a BOM but counting its bytes", async () => {
    const snapshot = await source.getSnapshot();
    await expect(source.readFile(snapshot, "src/util.ts", { maxBytes: 1000 })).resolves.toEqual({
      kind: "text",
      content: "export function util() {}\n",
      size: 29,
    });
  });

  it("honours maxBytes, binary markers, missing files and unsafe paths", async () => {
    const snapshot = await source.getSnapshot();
    await expect(source.readFile(snapshot, "src/app.ts", { maxBytes: 10 })).resolves.toEqual({
      kind: "too-large",
      size: 22,
    });
    await expect(
      source.readFile(snapshot, "assets/logo.png", { maxBytes: 10_000 }),
    ).resolves.toEqual({
      kind: "binary",
      size: 2048,
    });
    await expect(source.readFile(snapshot, "nope.ts", { maxBytes: 10 })).resolves.toEqual({
      kind: "missing",
    });
    await expect(source.readFile(snapshot, "src/../escape.ts", { maxBytes: 10 })).resolves.toEqual({
      kind: "missing",
    });
  });

  it("classifies text with NUL bytes as binary", async () => {
    const nul = new MemorySource(spec({ files: { "a.bin": "abc\u0000def" } }));
    await expect(
      nul.readFile(await nul.getSnapshot(), "a.bin", { maxBytes: 100 }),
    ).resolves.toEqual({
      kind: "binary",
      size: 7,
    });
  });

  it("simulates an upstream failure for unreadable files", async () => {
    const snapshot = await source.getSnapshot();
    await expect(
      source.readFile(snapshot, "data/broken.json", { maxBytes: 1000 }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("simulates latency and honours abort signals", async () => {
    const slow = new MemorySource(spec({ readDelayMs: 1_000 }));
    const snapshot = await slow.getSnapshot();
    const controller = new AbortController();
    const pending = slow.readFile(snapshot, "README.md", {
      maxBytes: 100,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await expect(slow.getSnapshot(AbortSignal.abort())).rejects.toMatchObject({ code: "ABORTED" });
    await expect(slow.listTree(snapshot, AbortSignal.abort())).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("waits for the configured delay", async () => {
    const slow = new MemorySource(spec({ readDelayMs: 30 }));
    const snapshot = await slow.getSnapshot();
    const started = performance.now();
    await slow.readFile(snapshot, "README.md", { maxBytes: 100 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe("MemorySource history", () => {
  it("lists commits newest first honouring maxCommits, without detail fields", async () => {
    const source = new MemorySource(spec());
    const snapshot = await source.getSnapshot();
    const listed = await source.listCommits(snapshot, { maxCommits: 2 });
    expect(listed.map((commit) => commit.message)).toEqual(["Third", "Second"]);
    expect(listed[0]).not.toHaveProperty("files");
    expect(listed[0]).not.toHaveProperty("additions");
    expect(await source.listCommits(snapshot, { maxCommits: 0 })).toEqual([]);
  });

  it("returns commit details with sanitized files, or NOT_FOUND", async () => {
    const source = new MemorySource(spec());
    const snapshot = await source.getSnapshot();
    const details = await source.getCommitDetails(snapshot, "C".repeat(40));
    expect(details.files).toEqual(["src/app.ts", "README.md"]);
    expect(details.additions).toBe(5);
    await expect(source.getCommitDetails(snapshot, "d".repeat(40))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("derives contributors from commits when none are specified", async () => {
    const source = new MemorySource(
      spec({ repository: { owner: "acme", name: "app", provider: "github" } }),
    );
    const contributors = await source.listContributors(await source.getSnapshot());
    expect(contributors).toEqual([
      { login: "grace", name: "grace", profileUrl: "https://github.com/grace", contributions: 2 },
      { name: "Alan Turing", contributions: 1 },
    ]);
  });

  it("returns specified contributors sorted by contributions", async () => {
    const source = new MemorySource(
      spec({
        contributors: [
          { name: "b", contributions: 1 },
          { name: "a", login: "a", contributions: 5 },
        ],
      }),
    );
    const contributors = await source.listContributors(await source.getSnapshot());
    expect(contributors.map((contributor) => contributor.name)).toEqual(["a", "b"]);
  });

  it("omits optional history methods when capabilities are off", () => {
    const source = new MemorySource(spec());
    expect(source.capabilities).toEqual({ fileHistory: false, commitCounts: false });
    expect(source.getFileActivity).toBeUndefined();
    expect(source.getCommitCounts).toBeUndefined();
  });

  it("serves explicit file activity and derives the rest from commits", async () => {
    const source = new MemorySource(
      spec({
        fileActivity: {
          "README.md": { lastModified: "2026-09-01T00:00:00.000Z", authorName: "Docs Bot" },
        },
      }),
    );
    expect(source.capabilities.fileHistory).toBe(true);
    const snapshot = await source.getSnapshot();
    const activity = await source.getFileActivity?.(snapshot, [
      "README.md",
      "src/util.ts",
      "docs/guide.md",
      "never-touched.ts",
      "../x",
    ]);
    expect(activity).toEqual(
      new Map([
        ["README.md", { lastModified: "2026-09-01T00:00:00.000Z", authorName: "Docs Bot" }],
        ["src/util.ts", { lastModified: "2026-02-15T00:00:00.000Z", authorName: "Alan Turing" }],
        [
          "docs/guide.md",
          {
            lastModified: "2026-01-05T00:00:00.000Z",
            authorName: "Grace H.",
            authorLogin: "Grace",
          },
        ],
      ]),
    );
  });

  it("counts commits per range, preferring explicit buckets", async () => {
    const explicit = {
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-04-01T00:00:00.000Z",
      commits: 42,
    };
    const source = new MemorySource(
      spec({ capabilities: { commitCounts: true }, commitCounts: [explicit] }),
    );
    const snapshot = await source.getSnapshot();
    const buckets = await source.getCommitCounts?.(snapshot, [
      { start: "2026-01-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" },
      { start: explicit.start, end: explicit.end },
      { start: "2026-03-10T00:00:00.000Z", end: "2026-03-11T00:00:00.000Z" },
      { start: "invalid", end: "2026-03-11T00:00:00.000Z" },
    ]);
    expect(buckets?.map((bucket) => bucket.commits)).toEqual([2, 42, 1, 0]);
  });

  it("reports the configured rate limit", () => {
    const rateLimit = {
      limit: 60,
      remaining: 10,
      resetAt: "2026-09-23T13:00:00.000Z",
      authenticated: false,
    };
    expect(new MemorySource(spec({ rateLimit })).getRateLimit()).toEqual(rateLimit);
    expect(new MemorySource(spec()).getRateLimit()).toBeUndefined();
  });
});
