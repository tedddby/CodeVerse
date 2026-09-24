import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import type { SourceCommit, SourceCommitDetails } from "@/sources/types";
import type { HistoryInput } from "./assemble";
import { runPipeline } from "./test-pipeline";

const files = [
  { path: "src/a.ts" },
  { path: "src/b.ts" },
  { path: "src/c.ts" },
  { path: "README.md" },
];

function commit(sha: string, date: string, author: Partial<SourceCommit> = {}): SourceCommit {
  return {
    sha,
    message: `Commit ${sha}`,
    authorName: "Someone",
    date,
    url: `https://github.com/acme/platform/commit/${sha}`,
    ...author,
  };
}

function details(base: SourceCommit, changed: string[]): SourceCommitDetails {
  return { ...base, files: changed };
}

function emptyHistory(overrides: Partial<HistoryInput> = {}): HistoryInput {
  return {
    commits: [],
    details: [],
    contributors: [],
    fileActivity: new Map(),
    commitCounts: null,
    perFileHistory: false,
    ...overrides,
  };
}

describe("contributors", () => {
  it("merges provider contributors with commit authors by login", () => {
    const c1 = commit("a1", "2026-09-01T00:00:00Z", {
      authorName: "Grace Hopper",
      authorLogin: "GraceH",
    });
    const c2 = commit("a2", "2026-08-01T00:00:00Z", {
      authorName: "G. Hopper",
      authorLogin: "graceh",
    });
    const c3 = commit("a3", "2026-07-01T00:00:00Z", { authorName: "  Linus   Torvalds " });
    const { graph } = runPipeline({
      files,
      history: emptyHistory({
        commits: [c1, c2, c3],
        details: [details(c1, ["src/a.ts"]), details(c3, ["src/b.ts", "gone.ts"])],
        contributors: [
          {
            login: "gracEH",
            name: "gracEH",
            contributions: 500,
            avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
          },
          {
            login: "octo",
            name: "octo",
            contributions: 30,
            avatarUrl: "https://evil.example.com/pixel.gif",
          },
          { name: "Anonymous Person", contributions: 4 },
        ],
      }),
    });

    expect(graph.contributors.map((contributor) => contributor.id)).toEqual([
      "user:graceh",
      "user:octo",
      "author:anonymous person",
      "author:linus torvalds",
    ]);
    const grace = graph.contributors[0];
    expect(grace).toMatchObject({
      name: "Grace Hopper",
      login: "gracEH",
      contributions: 500,
      commitCount: 2,
      avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
      profileUrl: "https://github.com/gracEH",
      fileIds: ["file:src/a.ts"],
    });
    const octo = graph.contributors[1];
    expect(octo?.name).toBe("octo");
    expect(octo?.avatarUrl).toBeUndefined();
    const linus = graph.contributors[3];
    expect(linus).toMatchObject({
      name: "Linus   Torvalds",
      contributions: 0,
      commitCount: 1,
      fileIds: ["file:src/b.ts"],
    });
    expect(linus?.login).toBeUndefined();
    expect(linus?.profileUrl).toBeUndefined();
    expect(graph.commits.find((entry) => entry.sha === "a3")?.authorId).toBe(
      "author:linus torvalds",
    );
  });

  it("links bot accounts to their app page and never keeps foreign avatar hosts", () => {
    const bot = commit("b1", "2026-09-01T00:00:00Z", {
      authorName: "dependabot[bot]",
      authorLogin: "dependabot[bot]",
      authorAvatarUrl: "https://avatars.githubusercontent.com.evil.test/x.png",
    });
    const { graph } = runPipeline({ files, history: emptyHistory({ commits: [bot] }) });
    expect(graph.contributors[0]).toMatchObject({
      profileUrl: "https://github.com/apps/dependabot",
    });
    expect(graph.contributors[0]?.avatarUrl).toBeUndefined();
  });

  it("caps contributors at 200 and drops references to contributors beyond the cap", () => {
    const commits = Array.from({ length: 260 }, (_, index) =>
      commit(
        `s${String(index).padStart(3, "0")}`,
        `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00Z`,
        {
          authorName: `Author ${String(index).padStart(3, "0")}`,
        },
      ),
    );
    const { graph } = runPipeline({
      files,
      history: emptyHistory({
        commits,
        details: commits.map((entry) => details(entry, ["src/a.ts"])),
      }),
    });
    expect(graph.contributors).toHaveLength(200);
    const index = buildGraphIndex(graph);
    const withAuthor = graph.commits.filter((entry) => entry.authorId !== undefined);
    expect(withAuthor).toHaveLength(200);
    for (const entry of withAuthor)
      expect(index.contributorsById.has(entry.authorId ?? "")).toBe(true);
    const activity = graph.files.find((file) => file.path === "src/a.ts")?.activity;
    expect(activity?.commitCount).toBe(260);
    expect(activity?.contributorIds).toHaveLength(10);
    for (const id of activity?.contributorIds ?? [])
      expect(index.contributorsById.has(id)).toBe(true);
  });
});

describe("file activity", () => {
  it("combines commit details with per-file history, keeping the latest change", () => {
    const recent = commit("r1", "2026-09-01T00:00:00Z", { authorName: "Ada", authorLogin: "ada" });
    const older = commit("r2", "2026-05-01T00:00:00Z", { authorName: "Bob", authorLogin: "bob" });
    const { graph } = runPipeline({
      files,
      history: emptyHistory({
        commits: [recent, older],
        details: [
          details(recent, ["src/a.ts"]),
          details(older, ["src/a.ts", "src/b.ts", "src/b.ts"]),
        ],
        fileActivity: new Map([
          [
            "src/b.ts",
            {
              lastModified: "2026-09-15T12:00:00+02:00",
              authorLogin: "carol",
              authorName: "Carol",
            },
          ],
          ["src/a.ts", { lastModified: "2026-01-01T00:00:00Z", authorLogin: "bob" }],
          ["src/c.ts", { lastModified: "2025-12-24T00:00:00Z", authorName: "Dan" }],
          ["not-in-graph.ts", { lastModified: "2026-09-20T00:00:00Z", authorLogin: "eve" }],
        ]),
        perFileHistory: true,
      }),
    });
    const activity = (path: string) => graph.files.find((file) => file.path === path)?.activity;
    expect(activity("src/a.ts")).toEqual({
      commitCount: 2,
      contributorIds: ["user:ada", "user:bob"],
      lastModified: "2026-09-01T00:00:00.000Z",
      lastAuthorId: "user:ada",
    });
    expect(activity("src/b.ts")).toEqual({
      commitCount: 1,
      contributorIds: ["user:bob", "user:carol"],
      lastModified: "2026-09-15T10:00:00.000Z",
      lastAuthorId: "user:carol",
    });
    expect(activity("src/c.ts")).toEqual({
      commitCount: 0,
      contributorIds: ["author:dan"],
      lastModified: "2025-12-24T00:00:00.000Z",
      lastAuthorId: "author:dan",
    });
    expect(activity("README.md")).toBeUndefined();
    expect(graph.contributors.some((contributor) => contributor.id === "user:eve")).toBe(false);
    expect(
      graph.contributors.find((contributor) => contributor.id === "user:carol")?.fileIds,
    ).toEqual(["file:src/b.ts"]);
    expect(graph.analysis.history).toMatchObject({ filesWithActivity: 3, perFileHistory: true });
    expect(graph.analysis.warnings.map((warning) => warning.code)).not.toContain("HISTORY_LIMITED");
  });

  it("counts a looked-up last commit inside the listed window as at least one commit", () => {
    const recent = commit("w1", "2026-09-01T00:00:00Z", { authorLogin: "ada" });
    const middle = commit("w2", "2026-07-01T00:00:00Z", { authorLogin: "bob" });
    const oldest = commit("w3", "2026-05-01T00:00:00Z", { authorLogin: "bob" });
    const { graph } = runPipeline({
      files,
      history: emptyHistory({
        // Only the newest commit has details; the others were listed without changed files.
        commits: [recent, middle, oldest],
        details: [details(recent, ["src/a.ts"])],
        fileActivity: new Map([
          ["src/a.ts", { lastModified: "2026-09-01T00:00:00Z", authorLogin: "ada" }],
          ["src/b.ts", { lastModified: "2026-07-01T00:00:00Z", authorLogin: "bob" }],
          ["src/c.ts", { lastModified: "2026-04-30T23:59:59Z", authorLogin: "bob" }],
        ]),
        perFileHistory: true,
      }),
    });
    const commits = (path: string) =>
      graph.files.find((file) => file.path === path)?.activity?.commitCount;
    expect(commits("src/a.ts")).toBe(1);
    expect(commits("src/b.ts")).toBe(1);
    // Last changed before the oldest listed commit: no commits within the window.
    expect(commits("src/c.ts")).toBe(0);
  });
});

describe("commits and timeline", () => {
  it("normalizes commit messages, dates and URLs", () => {
    const long = commit("m1", "2026-09-01T10:00:00+05:00", { message: `${"x".repeat(250)}\nbody` });
    const unsafe = commit("m2", "2026-08-01T00:00:00Z", {
      message: "  Tidy up  \r\nmore",
      url: "javascript:alert(1)",
    });
    const { graph } = runPipeline({ files, history: emptyHistory({ commits: [unsafe, long] }) });
    expect(graph.commits.map((entry) => entry.sha)).toEqual(["m1", "m2"]);
    expect(graph.commits[0]?.message).toHaveLength(200);
    expect(graph.commits[0]?.message.endsWith("…")).toBe(true);
    expect(graph.commits[0]?.date).toBe("2026-09-01T05:00:00.000Z");
    expect(graph.commits[1]).toMatchObject({
      message: "Tidy up",
      url: "https://github.com/acme/platform/commit/m2",
    });
    expect(graph.analysis.history).toMatchObject({
      commitsFetched: 2,
      commitsWithDetails: 0,
      newestCommitDate: "2026-09-01T05:00:00.000Z",
      oldestCommitDate: "2026-08-01T00:00:00.000Z",
    });
  });

  it("uses exact commit counts as a full-history timeline when available", () => {
    const { graph } = runPipeline({
      files,
      history: emptyHistory({
        commits: [commit("t1", "2026-09-01T00:00:00Z")],
        commitCounts: {
          granularity: "month",
          buckets: [
            { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z", commits: 4 },
            { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z", commits: 7 },
            { start: "bad", end: "2026-08-01T00:00:00Z", commits: 1 },
          ],
        },
      }),
    });
    expect(graph.timeline).toEqual({
      granularity: "month",
      coverage: "full-history",
      buckets: [
        { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z", commits: 7 },
        { start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z", commits: 4 },
      ],
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-10-01T00:00:00.000Z",
    });
  });

  it("reports missing history honestly", () => {
    const { graph } = runPipeline({ files, history: null });
    expect(graph.timeline).toEqual({ granularity: "week", coverage: "sampled", buckets: [] });
    expect(graph.analysis.warnings.map((warning) => warning.code)).toEqual(["HISTORY_UNAVAILABLE"]);
    expect(graph.files.every((file) => file.activity === undefined)).toBe(true);
  });
});
