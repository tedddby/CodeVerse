import { ROOT_DIRECTORY_ID } from "@/graph/model/ids";
import { GRAPH_SCHEMA_VERSION, type RepositoryGraph } from "@/graph/model/types";
import { buildDirectories } from "./assemble/directories";
import { buildFiles } from "./assemble/files";
import { buildHistory } from "./assemble/history";
import { buildLanguageStats } from "./assemble/languages";
import { buildReport } from "./assemble/report";
import type { AssembleInput, PreviewInput } from "./assemble/types";
import { compareStrings } from "./sort";

export { estimateLines } from "./line-estimate";
export type {
  AssembleInput,
  FileAnalysisResult,
  HistoryInput,
  PreviewInput,
} from "./assemble/types";

/**
 * Final stage: combine the inventory, per-file analyses, dependency resolution
 * and history into the normalized RepositoryGraph.
 *
 * Guarantees:
 * - every id reference (directory/file/symbol/contributor/edge endpoint) is valid;
 * - directory statistics and coverage counts agree with the files;
 * - the same inputs in any order serialize to byte-identical JSON.
 */
function assemble(rawInput: AssembleInput, preview: boolean): RepositoryGraph {
  // Normalize the inventory so ordering and totals never depend on how it was built.
  const inventoryFiles = [...rawInput.inventory.files].sort((a, b) =>
    compareStrings(a.path, b.path),
  );
  const totalBytes = inventoryFiles.reduce((sum, file) => sum + file.size, 0);
  const input: AssembleInput = {
    ...rawInput,
    inventory: { ...rawInput.inventory, files: inventoryFiles, totalBytes },
  };
  const graphInventory = inventoryFiles.filter((file) => input.graphFiles.has(file.path));
  const graphPaths = new Set(graphInventory.map((file) => file.path));

  const history = preview
    ? buildHistory(null, graphPaths, input.repository)
    : buildHistory(input.history, graphPaths, input.repository);

  const built = buildFiles({
    files: graphInventory,
    analyses: input.analyses,
    fetchPlan: input.fetchPlan,
    dependencies: preview ? null : input.dependencies,
    activity: history.activity,
    tier: input.tier,
    limits: input.limits,
    preview,
  });
  const filesByPath = new Map(built.files.map((file) => [file.path, file] as const));

  const directories = buildDirectories({
    repositoryName: input.repository.name,
    directories: input.inventory.directories,
    inventoryFiles,
    graphFiles: filesByPath,
  });

  const fileIds = new Set(built.files.map((file) => file.id));
  const dependencies = preview
    ? []
    : (input.dependencies?.edges ?? [])
        .filter(
          (edge) =>
            edge.source !== edge.target && fileIds.has(edge.source) && fileIds.has(edge.target),
        )
        .map((edge) => ({ ...edge }))
        .sort((a, b) => compareStrings(a.id, b.id));
  const externalPackages = preview
    ? []
    : (input.dependencies?.externalPackages ?? [])
        .map((pkg) => ({ ...pkg }))
        .sort((a, b) => b.importCount - a.importCount || compareStrings(a.name, b.name));

  const analysis = buildReport({
    input: preview ? { ...input, history: null, fetchPlan: null } : input,
    files: built.files,
    directoryCount: directories.length,
    symbolCount: built.symbols.length,
    importStats: built.importStats,
    history: history.summary,
    preview,
  });

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repository: { ...input.repository, topics: [...input.repository.topics] },
    rootDirectoryId: ROOT_DIRECTORY_ID,
    directories,
    files: built.files,
    symbols: built.symbols,
    dependencies,
    externalPackages,
    commits: history.commits,
    contributors: history.contributors,
    languages: buildLanguageStats(inventoryFiles, filesByPath),
    timeline: history.timeline,
    analysis,
  };
}

/** Builds the complete RepositoryGraph from every pipeline stage's output. */
export function assembleGraph(input: AssembleInput): RepositoryGraph {
  return assemble(input, false);
}

/**
 * Structure-only graph for the progressive "preview" event: every graph file is
 * metadata-only with estimated lines (binary files stay binary); no symbols,
 * dependencies or history.
 */
export function buildPreviewGraph(input: PreviewInput): RepositoryGraph {
  return assemble(
    {
      ...input,
      fetchPlan: null,
      analyses: new Map(),
      dependencies: null,
      history: null,
      bytesDownloaded: 0,
    },
    true,
  );
}
