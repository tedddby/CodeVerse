import { describe, expect, it } from "vitest";
import type { RepositoryGraph } from "@/graph/model/types";
import { runPipeline } from "./test-pipeline";

/**
 * Directory line totals describe the repository's own code: lockfiles,
 * generated bundles, vendored trees and binaries are counted as files but
 * not as lines of code (the same rule as the language statistics).
 */

function directory(graph: RepositoryGraph, path: string) {
  const node = graph.directories.find((candidate) => candidate.path === path);
  if (!node) throw new Error(`Expected directory ${path}`);
  return node;
}

describe("directory line totals", () => {
  it("leaves generated, vendored and binary files out of LOC but not out of file counts", () => {
    const { graph } = runPipeline({
      files: [
        { path: "src/index.ts", size: 2_000, lines: 80 },
        { path: "src/util.ts", size: 1_000, lines: 40 },
        { path: "pnpm-lock.yaml", size: 400_000 },
        { path: "dist/bundle.min.js", size: 90_000 },
        { path: "vendor/github.com/pkg/errors/errors.go", size: 9_000 },
        { path: "assets/logo.png", size: 40_000 },
      ],
    });
    const root = directory(graph, "");
    expect(root.stats.totalLines).toBe(120);
    expect(root.stats.linesEstimated).toBe(false);
    expect(root.stats.fileCount).toBe(6);
    expect(root.stats.totalBytes).toBe(2_000 + 1_000 + 400_000 + 90_000 + 9_000 + 40_000);
    expect(directory(graph, "vendor").stats).toMatchObject({ fileCount: 1, totalLines: 0 });
    expect(graph.languages.reduce((sum, language) => sum + language.lines, 0)).toBe(120);
  });

  it("counts every file when the repository has nothing but generated or vendored files", () => {
    const { graph } = runPipeline({
      files: [
        { path: "package-lock.json", size: 30_000 },
        { path: "vendor/lib.js", size: 3_000 },
      ],
    });
    const root = directory(graph, "");
    expect(root.stats.totalLines).toBeGreaterThan(0);
    expect(root.stats.totalLines).toBe(
      graph.languages.reduce((sum, language) => sum + language.lines, 0),
    );
  });
});
