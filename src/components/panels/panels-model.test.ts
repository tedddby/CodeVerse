import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { LanguageStat, RepositoryGraph } from "@/graph/model/types";
import {
  formatDuration,
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
  recentCommits,
  sortContributors,
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

  it("sorts by all-time contributions, then window commits", () => {
    const sorted = sortContributors(mockRepositoryGraph.contributors);
    expect(sorted.map((contributor) => contributor.login)).toEqual([
      "octo-ada",
      "octo-bruno",
      "octo-chen",
      "octo-dara",
    ]);
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
});
