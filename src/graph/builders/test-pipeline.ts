/**
 * Test-only helper: runs every graph builder stage (inventory -> selection ->
 * fetch plan -> analyses -> dependency resolution -> assembly) from a
 * declarative spec. Not imported by production code.
 */
import type { AnalysisWarning, RepositoryGraph, RepositoryInfo } from "@/graph/model/types";
import { DEFAULT_LIMITS, type AnalysisLimits } from "@/lib/config/limits";
import type { ParseResult } from "@/parser/types";
import type { SourceTreeEntry } from "@/sources/types";
import {
  assembleGraph,
  type AssembleInput,
  type FileAnalysisResult,
  type HistoryInput,
} from "./assemble";
import { resolveDependencies, type DependencyInputFile } from "./dependencies";
import {
  buildInventory,
  determineTier,
  planContentFetch,
  selectGraphFiles,
  type FetchPlan,
  type FileInventory,
} from "./inventory";

export interface PipelineFile {
  path: string;
  size?: number;
  /** Exact line count reported for downloaded files. */
  lines?: number;
  /** Parse result overrides for parsed files. */
  parse?: Partial<Omit<ParseResult, "language">>;
  /** Content for resolution config files. */
  content?: string;
  /** Simulate a parser failure. */
  fail?: boolean;
}

export interface PipelineSpec {
  files: PipelineFile[];
  extraEntries?: SourceTreeEntry[];
  limits?: Partial<AnalysisLimits>;
  history?: HistoryInput | null;
  warnings?: AnalysisWarning[];
  truncated?: boolean;
  timings?: Record<string, number>;
}

export interface PipelineRun {
  graph: RepositoryGraph;
  input: AssembleInput;
  inventory: FileInventory;
  graphFiles: Set<string>;
  fetchPlan: FetchPlan;
}

export const TEST_REPOSITORY: RepositoryInfo = {
  id: "github:acme/platform",
  provider: "github",
  owner: "acme",
  name: "platform",
  fullName: "acme/platform",
  description: "Test repository",
  url: "https://github.com/acme/platform",
  defaultBranch: "main",
  ref: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  stars: 42,
  forks: 7,
  topics: ["testing"],
  createdAt: "2024-01-10T00:00:00.000Z",
};

export function runPipeline(spec: PipelineSpec): PipelineRun {
  const limits: AnalysisLimits = { ...DEFAULT_LIMITS, ...spec.limits };
  const byPath = new Map(spec.files.map((file) => [file.path, file] as const));
  const entries: SourceTreeEntry[] = [
    ...spec.files.map((file) => ({
      path: file.path,
      type: "file" as const,
      size: file.size ?? 1_000,
    })),
    ...(spec.extraEntries ?? []),
  ];
  const inventory = buildInventory({ entries, truncated: spec.truncated ?? false });
  const tier = determineTier(inventory.files.length, limits);
  const graphFiles = selectGraphFiles(inventory, limits);
  const fetchPlan = planContentFetch(inventory, graphFiles, tier, limits);
  const inventoryByPath = new Map(inventory.files.map((file) => [file.path, file] as const));

  const analyses = new Map<string, FileAnalysisResult>();
  const dependencyInputs: DependencyInputFile[] = [];
  let bytesDownloaded = 0;
  for (const path of fetchPlan.parseFiles) {
    const file = inventoryByPath.get(path);
    const fileSpec = byPath.get(path);
    if (!file?.parserLanguage) continue;
    bytesDownloaded += file.size;
    const lines = fileSpec?.lines ?? 40;
    if (fileSpec?.fail) {
      analyses.set(path, { status: "failed", statusReason: "Parsing timed out", lines });
      continue;
    }
    const parse: ParseResult = {
      language: file.parserLanguage,
      symbols: [],
      imports: [],
      exports: [],
      lines,
      hasErrors: false,
      durationMs: 1,
      ...fileSpec?.parse,
    };
    analyses.set(path, { status: parse.hasErrors ? "partial" : "parsed", parse, lines });
    const input: DependencyInputFile = {
      path,
      language: file.language,
      parserLanguage: file.parserLanguage,
      imports: parse.imports,
    };
    if (parse.packageName) input.packageName = parse.packageName;
    dependencyInputs.push(input);
  }
  for (const path of fetchPlan.contentOnlyFiles) {
    const file = inventoryByPath.get(path);
    if (!file) continue;
    bytesDownloaded += file.size;
    analyses.set(path, { status: "content-only", lines: byPath.get(path)?.lines ?? 12 });
  }

  const configFiles = new Map(
    fetchPlan.configFiles.map((path) => [path, byPath.get(path)?.content ?? "{}"] as const),
  );
  const dependencies = resolveDependencies({
    files: dependencyInputs,
    graphPaths: graphFiles,
    allPaths: new Set(inventory.files.map((file) => file.path)),
    configFiles,
  });

  const input: AssembleInput = {
    repository: TEST_REPOSITORY,
    inventory,
    graphFiles,
    tier,
    fetchPlan,
    analyses,
    dependencies,
    history: spec.history === undefined ? null : spec.history,
    limits,
    warnings: spec.warnings ?? [],
    timings: spec.timings ?? { tree: 120, parse: 800 },
    startedAt: Date.parse("2026-09-23T10:00:00.000Z"),
    finishedAt: Date.parse("2026-09-23T10:00:04.500Z"),
    analyzerVersion: "test-1",
    bytesDownloaded,
  };
  return { graph: assembleGraph(input), input, inventory, graphFiles, fetchPlan };
}
