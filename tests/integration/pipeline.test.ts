import { beforeAll, describe, expect, it } from "vitest";
import { ANALYZER_VERSION } from "@/analysis/pipeline";
import { ANALYSIS_STAGES, type AnalysisEvent } from "@/analysis/protocol";
import { FETCH_REASONS } from "@/analysis/stages/fetch-stage";
import { expectConsistent } from "@/graph/builders/test-consistency";
import type { FileAnalysisStatus, RepositoryGraph } from "@/graph/model/types";
import { SourceError } from "@/sources/types";
import {
  fileByPath,
  finalStageEvents,
  memorySource,
  runPipeline,
  stageEvents,
  withoutTimings,
} from "./support/harness";
import { COMMITS, FILES, REPOSITORY, polyglotSpec } from "./support/polyglot-repository";

/**
 * End-to-end pipeline runs over a realistic multi-language repository with
 * the real tree-sitter parser, the real graph builders and an in-memory
 * source (no network).
 */

describe("analyzeRepository on a polyglot repository", () => {
  let graph: RepositoryGraph;
  let events: AnalysisEvent[];

  beforeAll(async () => {
    ({ graph, events } = await runPipeline(memorySource(polyglotSpec())));
  });

  it("produces a consistent graph covering every file of the tree", () => {
    expectConsistent(graph);
    expect(graph.files).toHaveLength(Object.keys(FILES).length);
    expect(graph.analysis.coverage.filesInRepository).toBe(Object.keys(FILES).length);
    expect(graph.analysis.tier).toBe("full");
    expect(graph.analysis.cached).toBe(false);
    expect(graph.analysis.analyzerVersion).toBe(ANALYZER_VERSION);
    expect(graph.repository).toMatchObject({
      id: "github:acme/polyglot",
      fullName: "acme/polyglot",
      stars: REPOSITORY.stars,
    });
    expect(graph.repository.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("assigns an honest status to every file", () => {
    const statuses: Record<string, FileAnalysisStatus> = {
      "apps/web/src/index.ts": "parsed",
      "apps/web/src/lib/format.ts": "parsed",
      "packages/utils/src/index.ts": "parsed",
      "python/acme/models.py": "parsed",
      "cmd/server/main.go": "parsed",
      "crates/core/src/lib.rs": "parsed",
      "java/src/main/java/com/acme/App.java": "parsed",
      "packages/utils/src/broken.ts": "partial",
      "apps/web/src/table.ts": "content-only",
      "README.md": "content-only",
      "assets/logo.png": "binary",
      "packages/utils/src/huge.ts": "metadata-only",
      "docs/flaky.md": "failed",
    };
    for (const [path, status] of Object.entries(statuses)) {
      expect({ path, status: fileByPath(graph, path).status }).toEqual({ path, status });
    }
    // Downloaded but over the parse limit: exact line count, no symbols.
    expect(fileByPath(graph, "apps/web/src/table.ts")).toMatchObject({
      lines: 1_802,
      linesEstimated: false,
      symbolIds: [],
    });
    expect(fileByPath(graph, "packages/utils/src/huge.ts")).toMatchObject({
      statusReason: "Not analyzed: larger than 64 KB",
      linesEstimated: true,
    });
    expect(fileByPath(graph, "docs/flaky.md").statusReason).toBe(FETCH_REASONS.failed);
    expect(fileByPath(graph, "packages/utils/src/broken.ts").statusReason).toMatch(/syntax errors/);
  });

  it("extracts symbols with kinds, parents, visibility and signatures", () => {
    const symbol = (id: string) => {
      const found = graph.symbols.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`missing symbol ${id}`);
      return found;
    };
    expect(symbol("sym:packages/utils/src/index.ts#greet@1")).toMatchObject({
      kind: "function",
      exported: true,
      signature: "function greet(name: string): string",
    });
    const greeter = symbol("sym:packages/utils/src/index.ts#Greeter@5");
    expect(greeter.kind).toBe("class");
    expect(symbol("sym:packages/utils/src/index.ts#greet@6").parentSymbolId).toBe(greeter.id);
    expect(symbol("sym:python/acme/models.py#User@1").kind).toBe("class");
    expect(symbol("sym:python/acme/models.py#display@5")).toMatchObject({
      kind: "method",
      parentSymbolId: "sym:python/acme/models.py#User@1",
    });
    expect(symbol("sym:internal/store/store.go#Open@4")).toMatchObject({
      kind: "function",
      exported: true,
    });
    expect(symbol("sym:crates/core/src/lib.rs#run@3").exported).toBe(true);
    expect(symbol("sym:java/src/main/java/com/acme/util/Strings.java#upper@4").kind).toBe("method");
    expect(fileByPath(graph, "packages/utils/src/index.ts").exports).toEqual(
      expect.arrayContaining(["greet", "Greeter", "helper"]),
    );
  });

  it("resolves dependencies in every language, including workspaces and tsconfig paths", () => {
    expect(graph.dependencies.map((edge) => edge.id).sort()).toEqual([
      "import:file:apps/web/src/index.ts->file:apps/web/src/lib/format.ts",
      "import:file:apps/web/src/index.ts->file:packages/utils/src/index.ts",
      "import:file:cmd/server/main.go->file:internal/store/store.go",
      "import:file:java/src/main/java/com/acme/App.java->file:java/src/main/java/com/acme/util/Strings.java",
      "import:file:python/acme/main.py->file:python/acme/models.py",
      "module:file:crates/core/src/lib.rs->file:crates/core/src/util.rs",
      "re-export:file:packages/utils/src/index.ts->file:packages/utils/src/helper.ts",
    ]);
    expect(graph.externalPackages.map((pkg) => `${pkg.language}:${pkg.name}`).sort()).toEqual([
      "go:fmt",
      "python:os",
      "typescript:react",
    ]);
    const web = fileByPath(graph, "apps/web/src/index.ts");
    expect(web.imports.find((ref) => ref.specifier === "react")).toMatchObject({ external: true });
    expect(web.imports.find((ref) => ref.specifier === "@web/lib/format")?.resolvedFileId).toBe(
      "file:apps/web/src/lib/format.ts",
    );
  });

  it("reports coverage that matches the files", () => {
    const count = (status: FileAnalysisStatus) =>
      graph.files.filter((file) => file.status === status).length;
    expect(graph.analysis.coverage).toMatchObject({
      filesParsed: count("parsed"),
      filesPartial: 1,
      filesContentOnly: count("content-only"),
      filesMetadataOnly: 1,
      filesBinary: 1,
      filesFailed: 1,
      importsFound: 10,
      importsResolved: 7,
      externalImports: 3,
    });
    expect(graph.analysis.coverage.bytesDownloaded).toBeGreaterThan(0);
    expect(graph.analysis.coverage.bytesDownloaded).toBeLessThanOrEqual(
      graph.analysis.limits.maxTotalBytes,
    );
  });

  it("raises warnings for the file that failed", () => {
    const codes = graph.analysis.warnings.map((warning) => warning.code);
    expect(codes).toEqual(["PARSE_FAILURES", "FETCH_FAILURES"]);
    expect(graph.analysis.warnings[1]?.message).toBe("1 file could not be downloaded.");
  });

  it("includes history, contributors, per-file activity and an exact timeline", () => {
    expect(graph.commits.map((commit) => commit.sha)).toEqual(COMMITS.map((commit) => commit.sha));
    expect(graph.contributors.map((contributor) => contributor.id).sort()).toEqual([
      "user:ada",
      "user:grace",
    ]);
    expect(graph.analysis.history).toMatchObject({
      commitsFetched: 3,
      commitsWithDetails: 3,
      perFileHistory: true,
    });
    expect(graph.timeline.coverage).toBe("full-history");
    expect(graph.timeline.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(3);
    expect(fileByPath(graph, "crates/core/src/lib.rs").activity).toMatchObject({
      lastModified: "2026-09-20T10:00:00.000Z",
      lastAuthorId: "user:ada",
    });
    expect(graph.analysis.rateLimit).toMatchObject({ limit: 5_000, remaining: 4_200 });
  });

  it("emits every stage in protocol order with exactly one final status each", () => {
    const stages = stageEvents(events);
    const firstSeen = [...new Set(stages.map((event) => event.stage))];
    expect(firstSeen).toEqual([...ANALYSIS_STAGES]);
    for (const stage of ANALYSIS_STAGES) {
      const ofStage = stages.filter((event) => event.stage === stage);
      expect(ofStage[0]?.status).toBe("start");
      const finals = ofStage.filter(
        (event) => event.status !== "start" && event.status !== "progress",
      );
      expect(finals).toHaveLength(1);
      expect(ofStage[ofStage.length - 1]).toBe(finals[0]);
      const progress = ofStage.flatMap((event) =>
        event.status === "progress" ? [event.progress ?? -1] : [],
      );
      for (const value of progress) expect(value).toBeGreaterThanOrEqual(0);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
    }
    // Stages never interleave: each one finishes before the next starts.
    const order = stages.map((event) => ANALYSIS_STAGES.indexOf(event.stage));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const typescript = graph.languages.find((language) => language.id === "typescript");
    expect(finalStageEvents(events).map((event) => `${event.stage}:${event.message}`)).toEqual([
      "connect:Repository found",
      `tree:${Object.keys(FILES).length} files`,
      `languages:TypeScript ${Math.round((typescript?.share ?? 0) * 100)}%`,
      expect.stringMatching(/^fetch:24 files · \d+ KB · 1 failure$/),
      "parse:14 files parsed",
      "dependencies:10 imports · 7 resolved",
      "history:3 commits · 2 contributors",
      "construct:Complete",
    ]);
  });

  it("sends a structure-only preview before the final graph and ends with one terminal event", () => {
    const previewIndex = events.findIndex((event) => event.type === "preview");
    const languagesDone = events.findIndex(
      (event) => event.type === "stage" && event.stage === "languages" && event.status === "done",
    );
    const fetchStart = events.findIndex(
      (event) => event.type === "stage" && event.stage === "fetch" && event.status === "start",
    );
    expect(previewIndex).toBeGreaterThan(languagesDone);
    expect(previewIndex).toBeLessThan(fetchStart);
    const preview = events[previewIndex];
    if (preview?.type !== "preview") throw new Error("expected a preview event");
    expect(preview.graph.files).toHaveLength(graph.files.length);
    expect(preview.graph.symbols).toEqual([]);
    expect(preview.graph.dependencies).toEqual([]);
    expect(new Set(preview.graph.files.map((file) => file.status))).toEqual(
      new Set(["metadata-only", "binary"]),
    );

    const terminal = events.filter((event) => event.type === "complete" || event.type === "error");
    expect(terminal).toHaveLength(1);
    expect(events[events.length - 1]).toBe(terminal[0]);
    expect(terminal[0]).toEqual({ type: "complete", graph });
  });
});

describe("analyzeRepository determinism and timing", () => {
  it("produces identical graphs for identical inputs and clocks", async () => {
    const first = await runPipeline(memorySource(polyglotSpec()));
    const second = await runPipeline(memorySource(polyglotSpec()));
    expect(JSON.stringify(withoutTimings(second.graph))).toBe(
      JSON.stringify(withoutTimings(first.graph)),
    );
    // With a fixed clock even the timing fields agree.
    expect(second.graph.analysis.timings).toEqual(first.graph.analysis.timings);
  });

  it("records a timing for every stage and the total duration", async () => {
    let clock = Date.parse("2026-09-23T12:00:00.000Z");
    const { graph } = await runPipeline(memorySource(polyglotSpec()), {
      now: () => (clock += 5),
    });
    expect(Object.keys(graph.analysis.timings).sort()).toEqual([...ANALYSIS_STAGES].sort());
    for (const stage of ANALYSIS_STAGES) {
      expect(graph.analysis.timings[stage]).toBeGreaterThanOrEqual(stage === "connect" ? 0 : 5);
    }
    expect(graph.analysis.durationMs).toBeGreaterThan(0);
    expect(Date.parse(graph.analysis.generatedAt)).toBe(clock);
  });
});

describe("analyzeRepository on an empty repository", () => {
  it("fails with EMPTY_REPOSITORY and emits no terminal event", async () => {
    const events: AnalysisEvent[] = [];
    const run = runPipeline(memorySource(polyglotSpec({ files: {}, commits: [] })), {
      onEvent: (event) => events.push(event),
    });
    await expect(run).rejects.toSatisfy(
      (error) => error instanceof SourceError && error.code === "EMPTY_REPOSITORY",
    );
    expect(events.some((event) => event.type === "complete" || event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "preview")).toBe(false);
  });
});
