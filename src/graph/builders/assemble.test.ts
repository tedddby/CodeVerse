import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/fixtures/fixture-builder";
import {
  assembleGraph,
  buildPreviewGraph,
  estimateLines,
  type AssembleInput,
  type HistoryInput,
} from "./assemble";
import { expectConsistent } from "./test-consistency";
import { runPipeline, type PipelineFile } from "./test-pipeline";

function shuffled<T>(values: Iterable<T>, seed: number): T[] {
  const random = mulberry32(seed);
  return [...values]
    .map((value) => ({ value, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.value);
}

const history: HistoryInput = {
  commits: [
    {
      sha: "c3",
      message: "Add JWT refresh\n\nLong body",
      authorName: "Ada Lovelace",
      authorLogin: "ada",
      date: "2026-09-20T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c3",
    },
    {
      sha: "c2",
      message: "Fix session bug",
      authorName: "Bruno",
      date: "2026-09-10T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c2",
    },
    {
      sha: "c1",
      message: "Initial commit",
      authorName: "Ada L.",
      authorLogin: "ada",
      date: "2026-08-01T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c1",
    },
  ],
  details: [
    {
      sha: "c3",
      message: "Add JWT refresh",
      authorName: "Ada Lovelace",
      authorLogin: "ada",
      date: "2026-09-20T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c3",
      files: ["src/auth/jwt.ts", "src/deleted.ts"],
      additions: 40,
      deletions: 2,
    },
    {
      sha: "c2",
      message: "Fix session bug",
      authorName: "Bruno",
      date: "2026-09-10T10:00:00Z",
      url: "https://github.com/acme/platform/commit/c2",
      files: ["src/auth/session.ts", "src/auth/jwt.ts"],
    },
  ],
  contributors: [
    {
      login: "ada",
      name: "ada",
      contributions: 120,
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    },
  ],
  fileActivity: new Map(),
  commitCounts: null,
  perFileHistory: false,
};

const platformFiles: PipelineFile[] = [
  { path: "package.json", content: JSON.stringify({ name: "platform" }), lines: 20 },
  {
    path: "tsconfig.json",
    content: `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }`,
    lines: 8,
  },
  {
    path: "src/index.ts",
    size: 2_400,
    lines: 80,
    parse: {
      imports: [
        { specifier: "@/auth/jwt", kind: "import", line: 1 },
        { specifier: "./auth/session", kind: "import", line: 2 },
        { specifier: "react", kind: "import", line: 3 },
        { specifier: "./nowhere", kind: "import", line: 4 },
      ],
      symbols: [
        {
          name: "main",
          kind: "function",
          startLine: 10,
          endLine: 40,
          exported: true,
          signature: "function main(): void",
        },
      ],
      exports: ["main", "main"],
    },
  },
  {
    path: "src/auth/jwt.ts",
    size: 6_000,
    lines: 210,
    parse: {
      imports: [{ specifier: "./session", kind: "type-import", line: 1 }],
      symbols: [
        {
          name: "TokenService",
          kind: "class",
          startLine: 5,
          endLine: 120,
          exported: true,
          signature: `class TokenService ${"x".repeat(300)}`,
        },
        {
          name: "sign",
          kind: "method",
          startLine: 20,
          endLine: 60,
          exported: false,
          parentIndex: 0,
          signature: "sign(\n  claims: Claims,\n): string",
        },
        {
          name: "sign",
          kind: "method",
          startLine: 20,
          endLine: 60,
          exported: false,
          parentIndex: 0,
        },
        {
          name: "verify",
          kind: "method",
          startLine: 64,
          endLine: 110,
          exported: false,
          parentIndex: 0,
        },
        { name: "TTL", kind: "constant", startLine: 2, endLine: 2, exported: true },
        { name: "  ", kind: "variable", startLine: 3, endLine: 3, exported: false },
      ],
      exports: ["TokenService", "TTL"],
    },
  },
  {
    path: "src/auth/session.ts",
    size: 3_000,
    lines: 95,
    parse: { imports: [{ specifier: "./jwt", kind: "import", line: 1 }], hasErrors: true },
  },
  { path: "src/broken.ts", size: 500, fail: true, lines: 18 },
  { path: "src/legacy/huge.ts", size: 300 * 1024, lines: 9_000 },
  { path: "native/codec.c", size: 8_000 },
  { path: "native/codec.h", size: 1_000 },
  { path: "docs/guide.md", size: 5_000, lines: 120 },
  { path: "assets/logo.png", size: 40_000 },
  { path: "pnpm-lock.yaml", size: 200_000 },
];

describe("assembleGraph", () => {
  const run = runPipeline({ files: platformFiles, history });
  const { graph } = run;
  const file = (path: string) => graph.files.find((candidate) => candidate.path === path);

  it("produces a fully consistent graph", () => {
    expectConsistent(graph);
    expect(graph.schemaVersion).toBe(1);
    expect(graph.files.map((candidate) => candidate.path)).toEqual(
      [...graph.files.map((candidate) => candidate.path)].sort(),
    );
  });

  it("maps analysis results to statuses, reasons and line counts", () => {
    expect(file("src/index.ts")).toMatchObject({
      status: "parsed",
      lines: 80,
      linesEstimated: false,
    });
    expect(file("src/index.ts")?.statusReason).toBeUndefined();
    expect(file("src/auth/session.ts")?.status).toBe("partial");
    expect(file("src/auth/session.ts")?.statusReason).toMatch(/syntax errors/);
    expect(file("src/broken.ts")).toMatchObject({
      status: "failed",
      statusReason: "Parsing timed out",
      lines: 18,
    });
    expect(file("src/legacy/huge.ts")).toMatchObject({ status: "content-only", lines: 9_000 });
    expect(file("src/legacy/huge.ts")?.statusReason).toBe(
      "Larger than the 256 KB parse limit; lines counted only",
    );
    expect(file("docs/guide.md")).toMatchObject({ status: "content-only", lines: 120 });
    expect(file("assets/logo.png")).toMatchObject({
      status: "binary",
      lines: 0,
      linesEstimated: false,
    });
    expect(file("pnpm-lock.yaml")).toMatchObject({
      status: "metadata-only",
      statusReason: "Generated or vendored file",
      linesEstimated: true,
      lines: estimateLines(200_000, "yaml"),
      isGenerated: true,
    });
    expect(file("native/codec.c")?.status).toBe("content-only");
  });

  it("builds symbols in source order with parents, without duplicates or blank names", () => {
    const jwt = file("src/auth/jwt.ts");
    const symbols = graph.symbols.filter((symbol) => symbol.fileId === jwt?.id);
    expect(symbols.map((symbol) => `${symbol.name}@${symbol.startLine}`)).toEqual([
      "TTL@2",
      "TokenService@5",
      "sign@20",
      "verify@64",
    ]);
    expect(jwt?.symbolIds).toEqual(symbols.map((symbol) => symbol.id));
    const service = symbols.find((symbol) => symbol.name === "TokenService");
    expect(symbols.find((symbol) => symbol.name === "verify")?.parentSymbolId).toBe(service?.id);
    expect(service?.signature).toHaveLength(160);
    expect(service?.signature?.endsWith("…")).toBe(true);
    expect(symbols.find((symbol) => symbol.name === "sign")?.signature).toBe(
      "sign( claims: Claims, ): string",
    );
    expect(file("src/index.ts")?.exports).toEqual(["main"]);
  });

  it("wires resolved imports and dependency edges", () => {
    const refs = file("src/index.ts")?.imports ?? [];
    expect(refs.map((ref) => [ref.specifier, ref.resolvedFileId ?? null, ref.external])).toEqual([
      ["@/auth/jwt", "file:src/auth/jwt.ts", false],
      ["./auth/session", "file:src/auth/session.ts", false],
      ["react", null, true],
      ["./nowhere", null, false],
    ]);
    expect(graph.dependencies.map((edge) => edge.id)).toEqual([
      "import:file:src/auth/session.ts->file:src/auth/jwt.ts",
      "import:file:src/index.ts->file:src/auth/jwt.ts",
      "import:file:src/index.ts->file:src/auth/session.ts",
      "type-import:file:src/auth/jwt.ts->file:src/auth/session.ts",
    ]);
    expect(graph.externalPackages).toEqual([
      { name: "react", importCount: 1, fileCount: 1, language: "typescript" },
    ]);
    expect(graph.analysis.coverage).toMatchObject({
      importsFound: 6,
      importsResolved: 4,
      externalImports: 1,
      unresolvedImports: 1,
    });
  });

  it("computes directory statistics over the whole repository", () => {
    const src = graph.directories.find((directory) => directory.path === "src");
    expect(src?.stats).toMatchObject({
      fileCount: 5,
      directFileCount: 2,
      directDirectoryCount: 2,
      omittedFileCount: 0,
    });
    expect(src?.stats.symbolCount).toBe(5);
    expect(src?.stats.languageBytes).toEqual({
      typescript: 2_400 + 6_000 + 3_000 + 500 + 300 * 1024,
    });
    const root = graph.directories.find((directory) => directory.path === "");
    expect(root?.name).toBe("platform");
    // The size-estimated pnpm-lock.yaml is not code: it neither adds lines nor makes them estimates.
    expect(root?.stats.linesEstimated).toBe(false);
    expect(root?.stats.totalLines).toBe(
      graph.languages.reduce((sum, language) => sum + language.lines, 0),
    );
    expect(root?.stats.fileCount).toBe(platformFiles.length);
    expect(Object.keys(root?.stats.languageBytes ?? {})).toEqual(
      [...Object.keys(root?.stats.languageBytes ?? {})].sort(),
    );
  });

  it("summarizes languages by bytes with unsupported languages reported", () => {
    const typescript = graph.languages.find((language) => language.id === "typescript");
    expect(typescript).toMatchObject({ files: 5, parseable: true, name: "TypeScript" });
    const shares = graph.languages.reduce((sum, language) => sum + language.share, 0);
    expect(shares).toBeCloseTo(1, 10);
    const known = graph.languages.filter((language) => language.id !== "unknown");
    const bytes = known.map((language) => language.bytes);
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
    // Binary files (the PNG) don't describe what the repository is written in.
    const languageBytes = graph.languages.reduce((sum, language) => sum + language.bytes, 0);
    const binaryBytes = graph.files
      .filter((file) => file.status === "binary")
      .reduce((sum, file) => sum + file.size, 0);
    const generatedBytes = graph.files
      .filter((file) => file.isGenerated && file.status !== "binary")
      .reduce((sum, file) => sum + file.size, 0);
    expect(binaryBytes).toBe(40_000);
    expect(languageBytes).toBe(
      graph.analysis.coverage.bytesInRepository - binaryBytes - generatedBytes,
    );
    expect(graph.languages.some((language) => language.id === "unknown" && language.bytes === 40_000)).toBe(false);
    expect(graph.analysis.unsupportedLanguages).toEqual([{ language: "c", name: "C", files: 2 }]);
  });

  it("writes the analysis report", () => {
    const { analysis } = graph;
    expect(analysis).toMatchObject({
      tier: "full",
      generatedAt: "2026-09-23T10:00:04.500Z",
      durationMs: 4_500,
      treeTruncated: false,
      cached: false,
      analyzerVersion: "test-1",
      timings: { parse: 800, tree: 120 },
    });
    expect(Object.keys(analysis.timings)).toEqual(["parse", "tree"]);
    expect(analysis.limits.maxFiles).toBe(25_000);
    expect(analysis.warnings.map((warning) => warning.code)).toEqual([
      "UNSUPPORTED_LANGUAGES",
      "PARSE_FAILURES",
      "HISTORY_LIMITED",
    ]);
    expect(analysis.warnings[0]?.message).toBe(
      "Some files could not be parsed because their language is not currently supported: C.",
    );
    expect(analysis.warnings[1]?.message).toBe(
      "1 file could not be analyzed; its symbols and imports are missing.",
    );
    // Only 2 of the 3 listed commits have file details.
    expect(analysis.warnings[2]?.message).toBe(
      "Activity is based on the latest 3 commits; file-level activity on the latest 2.",
    );
  });

  it("attaches history: activity, commits and contributors", () => {
    expect(file("src/auth/jwt.ts")?.activity).toEqual({
      commitCount: 2,
      contributorIds: ["author:bruno", "user:ada"],
      lastModified: "2026-09-20T10:00:00.000Z",
      lastAuthorId: "user:ada",
    });
    expect(graph.commits.map((commit) => commit.sha)).toEqual(["c3", "c2", "c1"]);
    expect(graph.commits[0]).toMatchObject({
      message: "Add JWT refresh",
      authorId: "user:ada",
      fileIds: ["file:src/auth/jwt.ts"],
      changedFileCount: 2,
      additions: 40,
      deletions: 2,
    });
    expect(graph.commits[2]?.fileIds).toBeUndefined();
    expect(
      graph.contributors.map((contributor) => [
        contributor.id,
        contributor.name,
        contributor.commitCount,
      ]),
    ).toEqual([
      ["user:ada", "Ada Lovelace", 2],
      ["author:bruno", "Bruno", 1],
    ]);
    expect(graph.timeline.coverage).toBe("sampled");
    expect(graph.timeline.buckets.reduce((sum, bucket) => sum + bucket.commits, 0)).toBe(3);
    expect(graph.analysis.history).toMatchObject({
      commitsFetched: 3,
      commitsWithDetails: 2,
      filesWithActivity: 2,
    });
  });

  it("serializes identically for shuffled inputs", () => {
    const baseline = JSON.stringify(graph);
    for (const seed of [11, 12, 13]) {
      const input: AssembleInput = {
        ...run.input,
        inventory: {
          ...run.input.inventory,
          files: shuffled(run.input.inventory.files, seed),
          directories: shuffled(run.input.inventory.directories, seed),
        },
        graphFiles: new Set(shuffled(run.input.graphFiles, seed + 1)),
        analyses: new Map(shuffled(run.input.analyses, seed + 2)),
        history: {
          ...history,
          commits: shuffled(history.commits, seed + 3),
          details: shuffled(history.details, seed + 4),
          contributors: shuffled(history.contributors, seed + 5),
        },
        timings: Object.fromEntries(shuffled(Object.entries(run.input.timings), seed + 6)),
      };
      expect(JSON.stringify(assembleGraph(input))).toBe(baseline);
    }
  });
});

describe("buildPreviewGraph", () => {
  it("builds a structure-only graph with estimated lines", () => {
    const run = runPipeline({ files: platformFiles, history });
    const preview = buildPreviewGraph({ ...run.input });
    expectConsistent(preview);
    expect(preview.symbols).toEqual([]);
    expect(preview.dependencies).toEqual([]);
    expect(preview.commits).toEqual([]);
    expect(preview.contributors).toEqual([]);
    expect(preview.analysis.coverage.bytesDownloaded).toBe(0);
    for (const candidate of preview.files) {
      if (candidate.path === "assets/logo.png") expect(candidate.status).toBe("binary");
      else
        expect(candidate).toMatchObject({
          status: "metadata-only",
          statusReason: "Analysis in progress",
          linesEstimated: true,
        });
    }
    expect(preview.analysis.warnings.map((warning) => warning.code)).toEqual([
      "UNSUPPORTED_LANGUAGES",
    ]);
  });
});
