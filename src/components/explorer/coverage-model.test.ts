import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { AnalysisReport } from "@/graph/model/types";
import { buildCoverageSummary } from "./coverage-model";

const NOW = Date.parse("2026-09-02T00:00:00.000Z");
const base = mockRepositoryGraph.analysis;

type ReportPatch = Omit<Partial<AnalysisReport>, "coverage"> & { coverage?: Partial<AnalysisReport["coverage"]> };

function report(patch: ReportPatch): AnalysisReport {
  return { ...base, ...patch, coverage: { ...base.coverage, ...patch.coverage } };
}

describe("buildCoverageSummary", () => {
  it("reports complete coverage only when nothing was left out", () => {
    const summary = buildCoverageSummary(base, NOW);
    expect(summary.complete).toBe(true);
    expect(summary.tierLabel).toBe("Full analysis");
    const parsed = base.coverage.filesParsed + base.coverage.filesPartial;
    expect(summary.headline).toBe(`Parsed ${parsed} of ${base.coverage.filesInRepository} files`);
    expect(summary.rows.find((row) => row.label === "Analysed")?.value).toBe("yesterday");
  });

  it("never implies full coverage for a limited analysis", () => {
    const summary = buildCoverageSummary(
      report({
        tier: "progressive",
        treeTruncated: true,
        coverage: { filesInRepository: 12_482, filesInGraph: 12_482, filesParsed: 1_450, filesPartial: 50, filesMetadataOnly: 10_000 },
        warnings: [{ code: "PARSE_LIMIT", message: "Parsed the 1,500 most relevant files of 12,482." }],
      }),
      NOW,
    );
    expect(summary.complete).toBe(false);
    expect(summary.headline).toBe("Parsed 1,500 of 12,482+ files");
    expect(summary.tierLabel).toBe("Progressive analysis");
    expect(summary.rows).toContainEqual({ label: "Size only (not downloaded)", value: "10,000" });
    expect(summary.notices).toContain("Parsed the 1,500 most relevant files of 12,482.");
    expect(summary.notices.some((notice) => notice.includes("truncated the file listing"))).toBe(true);
  });

  it("treats files dropped from the graph as incomplete even in the full tier", () => {
    const summary = buildCoverageSummary(report({ coverage: { filesInRepository: 100, filesInGraph: 90 } }), NOW);
    expect(summary.complete).toBe(false);
  });

  it("lists unsupported languages and missing history", () => {
    const summary = buildCoverageSummary(
      report({
        unsupportedLanguages: [
          { language: "c", name: "C", files: 3_000 },
          { language: "cpp", name: "C++", files: 1_204 },
          { language: "ruby", name: "Ruby", files: 5 },
          { language: "php", name: "PHP", files: 2 },
          { language: "lua", name: "Lua", files: 1 },
        ],
        history: { ...base.history, commitsFetched: 0 },
      }),
      NOW,
    );
    expect(summary.notices).toContain(
      "No parser yet for C (3,000 files), C++ (1,204 files), Ruby (5 files), PHP (2 files) and 1 more: those files show size and line counts only.",
    );
    expect(summary.notices).toContain("Commit history was not available, so activity and contributor views are empty.");
  });

  it("does not duplicate notices already reported as warnings", () => {
    const summary = buildCoverageSummary(
      report({
        treeTruncated: true,
        warnings: [
          { code: "TREE_TRUNCATED", message: "GitHub returned a truncated tree." },
          { code: "TREE_TRUNCATED", message: "GitHub returned a truncated tree." },
        ],
      }),
      NOW,
    );
    expect(summary.notices.filter((notice) => /truncated/.test(notice))).toEqual(["GitHub returned a truncated tree."]);
    // Sampled history (no per-file lookups) is still called out.
    expect(summary.notices).toContain(`Activity is based on the ${base.history.commitsFetched} most recent commits.`);
  });
});
