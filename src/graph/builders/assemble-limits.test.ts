import { describe, expect, it } from "vitest";
import type { HistoryInput } from "./assemble";
import { expectConsistent } from "./test-consistency";
import { runPipeline, type PipelineFile } from "./test-pipeline";

const history: HistoryInput = {
  commits: [
    {
      sha: "c3",
      message: "Third",
      authorName: "Ada",
      authorLogin: "ada",
      date: "2026-09-20T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c3",
    },
    {
      sha: "c2",
      message: "Second",
      authorName: "Bruno",
      date: "2026-09-10T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c2",
    },
    {
      sha: "c1",
      message: "First",
      authorName: "Ada",
      authorLogin: "ada",
      date: "2026-08-01T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c1",
    },
  ],
  details: [],
  contributors: [],
  fileActivity: new Map(),
  commitCounts: null,
  perFileHistory: false,
};

describe("assembleGraph with limits", () => {
  const files: PipelineFile[] = [
    ...Array.from({ length: 30 }, (_, index) => ({
      path: `src/core/m${String(index).padStart(2, "0")}.ts`,
      size: 900,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      path: `fixtures/data/sample${String(index).padStart(2, "0")}.json`,
      size: 3_000,
    })),
    { path: "README.md", size: 2_000 },
  ];

  it("keeps omitted directories as nodes with repository-wide statistics", () => {
    const { graph } = runPipeline({
      files,
      limits: { maxFiles: 20, maxParsedFiles: 5, tierFullMax: 5, tierProgressiveMax: 10 },
    });
    expectConsistent(graph);
    expect(graph.files).toHaveLength(20);
    const data = graph.directories.find((directory) => directory.path === "fixtures/data");
    expect(data).toBeDefined();
    expect(data?.stats.fileCount).toBe(12);
    expect(data?.stats.omittedFileCount).toBe(
      data ? data.stats.fileCount - data.fileIds.length : -1,
    );
    expect(data?.stats.totalBytes).toBe(36_000);
    expect(data?.stats.linesEstimated).toBe(true);
    expect(data?.stats.totalLines).toBeGreaterThan(0);
  });

  it("explains every limit honestly", () => {
    const { graph } = runPipeline({
      files,
      truncated: true,
      limits: { maxFiles: 20, maxParsedFiles: 5, tierFullMax: 5, tierProgressiveMax: 10 },
      history,
    });
    expect(graph.analysis.tier).toBe("directory-first");
    const byCode = new Map(
      graph.analysis.warnings.map((warning) => [warning.code, warning] as const),
    );
    expect([...byCode.keys()]).toEqual([
      "TREE_TRUNCATED",
      "LARGE_REPOSITORY",
      "FILE_NODE_LIMIT",
      "PARSE_LIMIT",
      "HISTORY_LIMITED",
    ]);
    expect(byCode.get("FILE_NODE_LIMIT")?.message).toBe(
      "Showing 20 of 43 files as buildings; directory totals include the rest.",
    );
    expect(byCode.get("PARSE_LIMIT")?.message).toMatch(
      /^Parsed 5 of \d+ eligible source files\. Other files show size-based estimates\.$/,
    );
    expect(byCode.get("LARGE_REPOSITORY")?.message).toBe(
      "This repository is very large. CodeVerse visualizes the architecture first and analyzed a representative sample of files.",
    );
    expect(byCode.get("HISTORY_LIMITED")?.message).toBe(
      "Activity is based on the latest 3 commits.",
    );
    const skipped = graph.files.find(
      (candidate) => candidate.status === "metadata-only" && candidate.path.endsWith(".ts"),
    );
    expect(skipped?.statusReason).toBe("Not analyzed: parse limit of 5 files reached");
  });

  it("lets pipeline warnings override derived ones with the same code", () => {
    const { graph } = runPipeline({
      files,
      limits: { maxFiles: 20 },
      warnings: [
        {
          code: "RATE_LIMIT_LOW",
          message: "GitHub API quota is low.",
          detail: { remaining: 12, limit: 60 },
        },
        { code: "FILE_NODE_LIMIT", message: "Custom limit message." },
      ],
    });
    const codes = graph.analysis.warnings.map((warning) => warning.code);
    expect(codes).toEqual(["FILE_NODE_LIMIT", "HISTORY_UNAVAILABLE", "RATE_LIMIT_LOW"]);
    expect(graph.analysis.warnings[0]?.message).toBe("Custom limit message.");
    expect(Object.keys(graph.analysis.warnings[2]?.detail ?? {})).toEqual(["limit", "remaining"]);
  });

  it("handles an empty repository", () => {
    const { graph } = runPipeline({ files: [] });
    expectConsistent(graph);
    expect(graph.directories).toHaveLength(1);
    expect(graph.analysis.warnings.map((warning) => warning.code)).toEqual(["EMPTY_REPOSITORY"]);
  });

  it("scales to very large repositories", () => {
    const words = ["core", "api", "ui", "net", "store", "render", "cli", "docs", "tests", "utils"];
    const extensions = ["ts", "tsx", "py", "go", "rs", "java", "md", "json", "css", "png"];
    const large: PipelineFile[] = Array.from({ length: 60_000 }, (_, index) => {
      const a = words[index % words.length] ?? "x";
      const b = words[Math.floor(index / 10) % words.length] ?? "y";
      const extension = extensions[Math.floor(index / 7) % extensions.length] ?? "ts";
      return {
        path: `${a}/${b}/group${index % 300}/file${index}.${extension}`,
        size: 2_000 + (index % 50) * 100,
      };
    });
    const started = performance.now();
    const { graph } = runPipeline({ files: large });
    const elapsed = performance.now() - started;
    expect(graph.analysis.tier).toBe("directory-first");
    expect(graph.files).toHaveLength(25_000);
    expect(graph.analysis.coverage.filesInRepository).toBe(60_000);
    expectConsistent(graph);
    // Generous bound: catches accidental quadratic behaviour, not micro-regressions.
    expect(elapsed).toBeLessThan(15_000);
  });
});
