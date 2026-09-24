import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type {
  AnalysisWarning,
  CommitNode,
  ContributorNode,
  LanguageStat,
  RepositoryGraph,
} from "@/graph/model/types";
import {
  formatDuration,
  historyLimitExplanation,
  languageSegments,
  largestFiles,
  mostConnectedFiles,
  parseCoverage,
  repositoryStats,
  safeHttpsUrl,
  stageTimings,
  topExternalPackages,
} from "./analytics-model";
import {
  historyWindowDescription,
  initials,
  isSafeAvatarUrl,
  mostActiveAreas,
  noFileChangesNote,
  partitionByWindowActivity,
  recentCommits,
  sortContributors,
  touchedFilesInWindow,
} from "./contributors-model";

const index = buildGraphIndex(mockRepositoryGraph);

describe("analytics model", () => {
  it("summarizes the repository", () => {
    const stats = repositoryStats(index);
    expect(stats.stars).toBe(1284);
    expect(stats.filesInRepository).toBe(mockRepositoryGraph.files.length);
    expect(stats.symbols).toBe(mockRepositoryGraph.symbols.length);
    expect(stats.dependencies).toBe(mockRepositoryGraph.dependencies.length);
    expect(stats.linesOfCode).toBe(
      mockRepositoryGraph.files.reduce((sum, file) => sum + file.lines, 0),
    );
    expect(stats.contributors).toBe(4);
    const coverage = mockRepositoryGraph.analysis.coverage;
    expect(stats.filesAnalysed).toBe(
      coverage.filesParsed + coverage.filesPartial + coverage.filesContentOnly,
    );
  });

  it("folds the language tail into an 'Other' segment and keeps shares summing to 1", () => {
    const languages: LanguageStat[] = Array.from({ length: 12 }, (_, i) => ({
      id: `lang${i}`,
      name: `Lang ${i}`,
      color: "#fff",
      files: 1,
      bytes: 1000 - i * 50,
      lines: 10,
      share: 0,
      parseable: i < 2,
    }));
    const segments = languageSegments(languages, 5);
    expect(segments).toHaveLength(5);
    expect(segments[0]?.id).toBe("lang0");
    expect(segments[4]).toMatchObject({ id: "other", name: "8 others", files: 8 });
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1, 10);
    expect(languageSegments([], 5)).toEqual([]);
  });

  it("ranks packages, largest and most-connected files", () => {
    const packages = topExternalPackages(mockRepositoryGraph.externalPackages, 3);
    expect(packages[0]?.name).toBe("vitest");
    expect(packages).toHaveLength(3);

    const largest = largestFiles(mockRepositoryGraph, 3);
    // The 6,400-line lockfile is generated and excluded.
    expect(largest.map((file) => file.path)).toEqual([
      "src/auth/auth.ts",
      "src/payments/stripe.ts",
      "public/styles.css",
    ]);

    const connected = mostConnectedFiles(index, 2);
    const degree = (id: string) =>
      (index.dependenciesBySource.get(id)?.length ?? 0) +
      (index.dependenciesByTarget.get(id)?.length ?? 0);
    expect(connected[0]?.incoming ?? 0).toBeGreaterThan(0);
    expect((connected[0]?.incoming ?? 0) + (connected[0]?.outgoing ?? 0)).toBe(
      Math.max(...mockRepositoryGraph.files.map((file) => degree(file.id))),
    );
  });

  it("measures parse coverage over parseable, non-generated files", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "a.ts", lines: 10 },
        { path: "b.ts", lines: 10, status: "metadata-only" },
        { path: "c.py", lines: 10, status: "partial" },
        { path: "README.md", lines: 10 },
      ],
    });
    expect(parseCoverage(graph)).toEqual({ parsed: 2, eligible: 3, share: 2 / 3 });
  });

  it("orders stage timings by pipeline stage and formats durations", () => {
    const timings = stageTimings({ parse: 1200, custom: 5, connect: 80, tree: 300 });
    expect(timings.map((timing) => timing.id)).toEqual(["connect", "tree", "parse", "custom"]);
    expect(timings[0]?.label).toBe("Connecting to GitHub");
    expect(formatDuration(87)).toBe("87 ms");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });

  it("only allows https links", () => {
    expect(safeHttpsUrl("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpsUrl("http://example.com")).toBeUndefined();
    expect(safeHttpsUrl("not a url")).toBeUndefined();
    expect(safeHttpsUrl(undefined)).toBeUndefined();
  });

  describe("historyLimitExplanation", () => {
    const history = mockRepositoryGraph.analysis.history;
    const limited = (detail?: AnalysisWarning["detail"]): AnalysisWarning => ({
      code: "HISTORY_LIMITED",
      message: "Activity is based on the latest 1 commits.",
      ...(detail ? { detail } : {}),
    });

    it("names each reason the history stage records", () => {
      expect(
        historyLimitExplanation(
          limited({ commits: 100, commitsWithDetails: 20, reason: "unauthenticated" }),
          history,
        ),
      ).toBe(
        "History limited: no GitHub token configured. Activity covers the latest 100 commits, with file changes from the latest 20 commits.",
      );
      expect(
        historyLimitExplanation(
          limited({ commits: 300, commitsWithDetails: 300, reason: "low-quota" }),
          history,
        ),
      ).toBe(
        "History limited: GitHub API quota running low. Activity covers the latest 300 commits.",
      );
      expect(
        historyLimitExplanation(
          limited({ commits: 300, commitsWithDetails: 0, reason: "time-budget" }),
          history,
        ),
      ).toBe(
        "History limited: analysis time budget reached. Activity covers the latest 300 commits, without file changes.",
      );
    });

    it("uses the singular for a single commit", () => {
      expect(
        historyLimitExplanation(
          limited({ commits: 2, commitsWithDetails: 1, reason: "low-quota" }),
          history,
        ),
      ).toBe(
        "History limited: GitHub API quota running low. Activity covers the latest 2 commits, with file changes from the latest commit.",
      );
      expect(
        historyLimitExplanation(
          limited({ commits: 1, commitsWithDetails: 1, reason: "time-budget" }),
          history,
        ),
      ).toBe("History limited: analysis time budget reached. Activity covers the latest commit.");
      expect(
        historyLimitExplanation(
          limited({ commits: 0, commitsWithDetails: 0, reason: "time-budget" }),
          history,
        ),
      ).toBe("History limited: analysis time budget reached. No commits were read.");
    });

    it("falls back to the history summary without a (known) reason or counts", () => {
      // Derived from the configured limits: no reason recorded.
      expect(historyLimitExplanation(limited(), history)).toBe(
        "History limited. Activity covers the latest 16 commits.",
      );
      expect(
        historyLimitExplanation(limited({ reason: "cosmic-rays" }), {
          ...history,
          commitsFetched: 300,
          commitsWithDetails: 40,
        }),
      ).toBe(
        "History limited. Activity covers the latest 300 commits, with file changes from the latest 40 commits.",
      );
    });
  });
});

describe("contributors model", () => {
  it("accepts avatars only from GitHub's avatar CDN", () => {
    expect(isSafeAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(true);
    expect(isSafeAvatarUrl("https://evil.example/avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isSafeAvatarUrl("http://avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isSafeAvatarUrl('https://avatars.githubusercontent.com/u/1" onerror="x')).toBe(false);
    expect(isSafeAvatarUrl(undefined)).toBe(false);
  });

  it("derives initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("octocat")).toBe("OC");
    expect(initials("jean-luc picard")).toBe("JP");
    expect(initials("  ")).toBe("?");
  });

  it("sorts by files touched in the window, then window commits, then all-time contributions", () => {
    const sorted = sortContributors(mockRepositoryGraph.contributors);
    // Bruno and Chen both touched 6 files in 3 commits; Bruno has more contributions.
    expect(sorted.map((contributor) => contributor.login)).toEqual([
      "octo-ada",
      "octo-bruno",
      "octo-chen",
      "octo-dara",
    ]);
  });

  it("ranks contributors with nothing in the analysed window last, however large their all-time count", () => {
    const [ada, bruno] = mockRepositoryGraph.contributors;
    if (!ada || !bruno) throw new Error("fixture has contributors");
    const founder = {
      ...ada,
      id: "user:founder",
      name: "Founder",
      login: "founder",
      contributions: 3_600,
      commitCount: 0,
      fileIds: [],
    };
    const bot = {
      ...bruno,
      id: "user:bot",
      name: "renovate[bot]",
      login: "renovate[bot]",
      contributions: 900,
      commitCount: 26,
      fileIds: [],
    };
    const sorted = sortContributors([founder, bot, bruno, ada]);
    expect(sorted.map((contributor) => contributor.id)).toEqual([
      ada.id,
      bruno.id,
      "user:bot",
      "user:founder",
    ]);
    const { active, inactive } = partitionByWindowActivity(sorted);
    expect(active.map((contributor) => contributor.id)).toEqual([ada.id, bruno.id]);
    expect(inactive.map((contributor) => contributor.id)).toEqual(["user:bot", "user:founder"]);
    expect(touchedFilesInWindow(founder)).toBe(false);
    expect(touchedFilesInWindow(ada)).toBe(true);
  });

  it("finds the most active areas at directory depth ≤ 2", () => {
    const ada = index.contributorsById.get("user:octo-ada");
    expect(ada).toBeDefined();
    if (!ada) return;
    const areas = mostActiveAreas(index, ada, 3);
    // Ada touched src/auth (jwt, session, auth, middleware), src/lib (db, logger, config), src/api, tests/.
    expect(areas[0]).toEqual({ directoryId: "dir:src/auth", label: "src/auth/", files: 4 });
    expect(areas[1]).toEqual({ directoryId: "dir:src/lib", label: "src/lib/", files: 3 });
    expect(areas).toHaveLength(3);
  });

  it("groups deep files into their depth-2 ancestor and skips root files", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-01-01T00:00:00.000Z",
      contributors: [{ login: "dev", name: "Dev", contributions: 10 }],
      files: [
        { path: "packages/react/src/a.js", lines: 1 },
        { path: "packages/react/src/deep/b.js", lines: 1 },
        { path: "packages/react-dom/c.js", lines: 1 },
        { path: "fixtures/d.js", lines: 1 },
        { path: "README.md", lines: 1 },
      ],
      commits: [
        {
          sha: "c1",
          message: "work",
          author: "dev",
          daysAgo: 1,
          files: [
            "packages/react/src/a.js",
            "packages/react/src/deep/b.js",
            "packages/react-dom/c.js",
            "fixtures/d.js",
            "README.md",
          ],
        },
      ],
    });
    const graphIndex = buildGraphIndex(graph);
    const dev = graphIndex.contributorsById.get("user:dev");
    expect(dev).toBeDefined();
    if (!dev) return;
    expect(mostActiveAreas(graphIndex, dev, 5).map((area) => [area.label, area.files])).toEqual([
      ["packages/react/", 2],
      ["fixtures/", 1],
      ["packages/react-dom/", 1],
    ]);
  });

  it("lists a contributor's recent commits newest first", () => {
    const commits = recentCommits(mockRepositoryGraph, "user:octo-bruno", 2);
    expect(commits.map((commit) => commit.message)).toEqual([
      "Add refund webhooks",
      "Checkout pricing rules",
    ]);
  });

  it("describes the analysed history window honestly", () => {
    expect(historyWindowDescription(mockRepositoryGraph)).toMatch(
      /^the latest 16 commits \(.+ – .+\)$/,
    );
    const partial: RepositoryGraph = {
      ...mockRepositoryGraph,
      analysis: {
        ...mockRepositoryGraph.analysis,
        history: {
          ...mockRepositoryGraph.analysis.history,
          commitsFetched: 300,
          commitsWithDetails: 40,
        },
      },
    };
    expect(historyWindowDescription(partial)).toMatch(
      /^file details of the latest 40 commits \(of 300 commits read/,
    );
    const none: RepositoryGraph = {
      ...mockRepositoryGraph,
      analysis: {
        ...mockRepositoryGraph.analysis,
        history: { ...mockRepositoryGraph.analysis.history, commitsFetched: 0 },
      },
    };
    expect(historyWindowDescription(none)).toBeNull();
  });

  describe("noFileChangesNote", () => {
    const quiet: ContributorNode = {
      id: "user:quiet",
      name: "Quiet Person",
      login: "quiet",
      contributions: 50,
      commitCount: 0,
      fileIds: [],
    };
    const commitByQuiet = (sha: string, fileIds?: string[]): CommitNode => ({
      sha,
      message: "chore: tidy",
      authorId: quiet.id,
      authorName: quiet.name,
      date: "2026-08-20T00:00:00.000Z",
      url: `https://github.com/codeverse-demo/acme-platform/commit/${sha}`,
      ...(fileIds ? { fileIds } : {}),
    });
    const graphWith = ({
      commitsFetched = mockRepositoryGraph.analysis.history.commitsFetched,
      commitsWithDetails = mockRepositoryGraph.analysis.history.commitsWithDetails,
      limited = false,
      extraCommits = [],
    }: {
      commitsFetched?: number;
      commitsWithDetails?: number;
      /** Adds a HISTORY_LIMITED warning: older commits were not read. */
      limited?: boolean;
      extraCommits?: CommitNode[];
    }): RepositoryGraph => ({
      ...mockRepositoryGraph,
      commits: [...extraCommits, ...mockRepositoryGraph.commits],
      analysis: {
        ...mockRepositoryGraph.analysis,
        warnings: limited
          ? [{ code: "HISTORY_LIMITED", message: "Activity is based on the latest commits." }]
          : [],
        history: { ...mockRepositoryGraph.analysis.history, commitsFetched, commitsWithDetails },
      },
    });

    it("says nothing for contributors with files, or when no history was analysed", () => {
      const ada = index.contributorsById.get("user:octo-ada");
      if (!ada) throw new Error("fixture has Ada");
      expect(noFileChangesNote(mockRepositoryGraph, ada)).toBeNull();
      expect(
        noFileChangesNote(graphWith({ commitsFetched: 0, commitsWithDetails: 0 }), quiet),
      ).toBeNull();
    });

    it("says how many of the latest commits were examined when history was limited", () => {
      expect(noFileChangesNote(graphWith({ limited: true }), quiet)).toBe(
        "No file changes in the analysed window — only the latest 16 commits were examined.",
      );
      // Reaching the commit limit also means older commits were not read.
      expect(
        noFileChangesNote(graphWith({ commitsFetched: 300, commitsWithDetails: 40 }), quiet),
      ).toBe("No file changes in the analysed window — only the latest 300 commits were examined.");
      expect(
        noFileChangesNote(
          graphWith({ commitsFetched: 1, commitsWithDetails: 1, limited: true }),
          quiet,
        ),
      ).toBe("No file changes in the analysed window — only the latest commit was examined.");
    });

    it("does not call a complete history a window", () => {
      expect(noFileChangesNote(mockRepositoryGraph, quiet)).toBe(
        "No file changes in the analysed history — none of its 16 commits are theirs.",
      );
      expect(
        noFileChangesNote(graphWith({ commitsFetched: 1, commitsWithDetails: 1 }), quiet),
      ).toBe("No file changes in the analysed history — its only commit is not theirs.");
    });

    it("explains commits in the window whose files were not fetched or are not shown", () => {
      const author = { ...quiet, commitCount: 2 };
      const undetailed = [commitByQuiet("q1"), commitByQuiet("q2")];
      expect(
        noFileChangesNote(graphWith({ limited: true, extraCommits: undetailed }), author),
      ).toBe(
        "No file changes in the analysed window — file details were fetched for only the latest 16 commits, and none are theirs.",
      );
      expect(
        noFileChangesNote(
          graphWith({ commitsWithDetails: 1, limited: true, extraCommits: undetailed }),
          author,
        ),
      ).toBe(
        "No file changes in the analysed window — file details were fetched for only the latest commit, which is not theirs.",
      );
      expect(
        noFileChangesNote(
          graphWith({ commitsWithDetails: 0, limited: true, extraCommits: undetailed }),
          author,
        ),
      ).toBe(
        "No file changes in the analysed window — file details were not fetched for any commit.",
      );
      // Details were fetched, but every file they changed is gone from the tree.
      expect(
        noFileChangesNote(
          graphWith({ extraCommits: [commitByQuiet("q1", []), commitByQuiet("q2")] }),
          author,
        ),
      ).toBe(
        "No changes to files in this view — the files their commits in the analysed window changed were deleted or are not shown.",
      );
    });
  });
});
