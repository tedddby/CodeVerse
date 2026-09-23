import type { FileAnalysisResult } from "@/graph/builders/assemble";
import {
  resolveDependencies,
  type DependencyInputFile,
  type DependencyResolutionResult,
} from "@/graph/builders/dependencies";
import type { FetchPlan, FileInventory, InventoryFile } from "@/graph/builders/inventory";
import type { PipelineContext } from "./context";
import { dependenciesMessage } from "./messages";

/**
 * Stage "dependencies": resolves the imports of every parsed file into
 * file-to-file edges and external packages, using the downloaded resolution
 * configs (package.json, tsconfig, go.mod, Cargo.toml, ...).
 */

export interface DependenciesStageInput {
  inventory: FileInventory;
  inventoryByPath: ReadonlyMap<string, InventoryFile>;
  graphFiles: ReadonlySet<string>;
  plan: FetchPlan;
  analyses: ReadonlyMap<string, FileAnalysisResult>;
  contents: ReadonlyMap<string, string>;
}

/** Parsed files as resolver input, sorted by path. */
export function dependencyInputs(
  analyses: ReadonlyMap<string, FileAnalysisResult>,
  inventoryByPath: ReadonlyMap<string, InventoryFile>,
): DependencyInputFile[] {
  const files: DependencyInputFile[] = [];
  for (const [path, analysis] of analyses) {
    const parse = analysis.parse;
    if (!parse || (analysis.status !== "parsed" && analysis.status !== "partial")) continue;
    const file = inventoryByPath.get(path);
    if (!file) continue;
    const input: DependencyInputFile = {
      path,
      language: file.language,
      parserLanguage: file.parserLanguage ?? parse.language,
      imports: parse.imports,
    };
    if (parse.packageName) input.packageName = parse.packageName;
    files.push(input);
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function runDependenciesStage(
  context: PipelineContext,
  input: DependenciesStageInput,
): DependencyResolutionResult | null {
  const stage = context.startStage("dependencies");
  const files = dependencyInputs(input.analyses, input.inventoryByPath);
  if (files.length === 0) {
    stage.finish("skipped", "No parsed source files");
    return null;
  }
  const configFiles = new Map<string, string>();
  for (const path of input.plan.configFiles) {
    const content = input.contents.get(path);
    if (content !== undefined) configFiles.set(path, content);
  }
  try {
    const result = resolveDependencies({
      files,
      graphPaths: input.graphFiles,
      allPaths: new Set(input.inventory.files.map((file) => file.path)),
      configFiles,
    });
    stage.finish(
      "done",
      dependenciesMessage(result.stats.importsFound, result.stats.importsResolved),
    );
    return result;
  } catch (error) {
    // Resolution is best-effort: imports stay listed, just unresolved.
    context.logger.error("dependency resolution failed", { error });
    stage.finish("warning", "Imports could not be resolved");
    return null;
  }
}
