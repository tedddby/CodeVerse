import { dependencyEdgeId, fileId, parentPath } from "@/graph/model/ids";
import type { DependencyEdge, ExternalPackage, ImportRef } from "@/graph/model/types";
import type { ParserLanguageId } from "@/lib/languages/registry";
import type { ParsedImport } from "@/parser/types";
import { compareStrings } from "../sort";
import { createGoResolver } from "./go";
import { createJavaResolver } from "./java";
import { createPythonResolver } from "./python";
import { createRustResolver } from "./rust";
import { createTypeScriptResolver } from "./typescript";
import {
  UNRESOLVED,
  type DependencyInputFile,
  type DependencyResolutionInput,
  type DependencyResolutionResult,
  type ImportStats,
  type LanguageResolver,
  type Resolution,
  type ResolverContext,
} from "./types";

export type {
  DependencyInputFile,
  DependencyResolutionInput,
  DependencyResolutionResult,
  ImportStats,
} from "./types";

/**
 * Stage 4: cross-file dependency resolution.
 *
 * Turns the raw import specifiers of parsed files into ImportRefs, file-to-file
 * DependencyEdges and aggregated ExternalPackages. Language-specific rules live
 * in the sibling resolver modules; this module only dispatches and aggregates.
 * Pure and deterministic: the same input in any order yields the same output.
 */

type ResolverFamily = "javascript" | "python" | "java" | "go" | "rust";

const FAMILY_BY_PARSER: Readonly<Record<ParserLanguageId, ResolverFamily>> = {
  typescript: "javascript",
  tsx: "javascript",
  javascript: "javascript",
  python: "python",
  java: "java",
  go: "go",
  rust: "rust",
};

const RESOLVER_FACTORIES: Readonly<
  Record<ResolverFamily, (context: ResolverContext) => LanguageResolver>
> = {
  javascript: createTypeScriptResolver,
  python: createPythonResolver,
  java: createJavaResolver,
  go: createGoResolver,
  rust: createRustResolver,
};

/**
 * Resolution runs over untrusted repository content; an unexpected failure on
 * one odd specifier must degrade to "unresolved" rather than abort the analysis.
 */
function resolveSafely(
  resolver: LanguageResolver | null,
  file: DependencyInputFile,
  imported: ParsedImport,
): Resolution {
  if (!resolver || typeof imported.specifier !== "string") return UNRESOLVED;
  try {
    return resolver.resolve(file, imported);
  } catch {
    return UNRESOLVED;
  }
}

/** Resolver used for a language whose resolver could not be built: every import stays unresolved. */
const UNRESOLVING: LanguageResolver = { resolve: () => UNRESOLVED };

/**
 * Builds a language's resolver. Factories read untrusted manifests (Cargo.toml,
 * pyproject.toml, go.mod, ...): a failure only costs that language its edges.
 */
function createResolverSafely(family: ResolverFamily, context: ResolverContext): LanguageResolver {
  try {
    return RESOLVER_FACTORIES[family](context);
  } catch {
    return UNRESOLVING;
  }
}

function emptyStats(): ImportStats {
  return { importsFound: 0, importsResolved: 0, externalImports: 0, unresolvedImports: 0 };
}

function buildContext(
  input: DependencyResolutionInput,
  files: DependencyInputFile[],
): ResolverContext {
  const filesByDirectory = new Map<string, string[]>();
  for (const path of [...input.allPaths].sort(compareStrings)) {
    const directory = parentPath(path);
    const list = filesByDirectory.get(directory);
    if (list) list.push(path);
    else filesByDirectory.set(directory, [path]);
  }
  return {
    allPaths: input.allPaths,
    graphPaths: input.graphPaths,
    configFiles: input.configFiles,
    filesByDirectory,
    files,
  };
}

interface ExternalAccumulator {
  importCount: number;
  files: Set<string>;
  languages: Map<string, number>;
}

function mostCommonLanguage(languages: ReadonlyMap<string, number>): string {
  let best = "unknown";
  let bestCount = -1;
  for (const [language, count] of languages) {
    if (count > bestCount || (count === bestCount && compareStrings(language, best) < 0)) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}

/** Resolves every import of every input file. See module docs for the per-language rules. */
export function resolveDependencies(input: DependencyResolutionInput): DependencyResolutionResult {
  const byPath = new Map<string, DependencyInputFile>();
  for (const file of input.files) if (!byPath.has(file.path)) byPath.set(file.path, file);
  const files = [...byPath.values()].sort((a, b) => compareStrings(a.path, b.path));
  const context = buildContext(input, files);
  const resolvers = new Map<ResolverFamily, LanguageResolver>();
  const resolverFor = (language: ParserLanguageId): LanguageResolver | null => {
    const family = FAMILY_BY_PARSER[language] as ResolverFamily | undefined;
    if (!family) return null;
    let resolver = resolvers.get(family);
    if (!resolver) {
      resolver = createResolverSafely(family, context);
      resolvers.set(family, resolver);
    }
    return resolver;
  };

  const importsByPath = new Map<string, ImportRef[]>();
  const statsByPath = new Map<string, ImportStats>();
  const edges = new Map<string, DependencyEdge>();
  const externals = new Map<string, ExternalAccumulator>();
  const stats = emptyStats();

  for (const file of files) {
    const resolver = resolverFor(file.parserLanguage);
    const sourceId = fileId(file.path);
    const refs: ImportRef[] = [];
    const fileStats = emptyStats();

    for (const imported of file.imports) {
      const resolution = resolveSafely(resolver, file, imported);
      const ref: ImportRef = {
        specifier: imported.specifier,
        kind: imported.kind,
        line: Number.isFinite(imported.line) && imported.line >= 1 ? Math.floor(imported.line) : 1,
        external: resolution.type === "external",
      };
      fileStats.importsFound += 1;

      if (resolution.type === "internal") {
        fileStats.importsResolved += 1;
        const targets = [...new Set(resolution.paths)].filter(
          (path) => path !== file.path && input.graphPaths.has(path),
        );
        const representative = targets[0];
        if (representative !== undefined) ref.resolvedFileId = fileId(representative);
        for (const target of targets) {
          const targetId = fileId(target);
          const id = dependencyEdgeId(imported.kind, sourceId, targetId);
          const edge = edges.get(id);
          if (edge) edge.weight += 1;
          else
            edges.set(id, {
              id,
              source: sourceId,
              target: targetId,
              kind: imported.kind,
              weight: 1,
            });
        }
      } else if (resolution.type === "external") {
        fileStats.externalImports += 1;
        let accumulator = externals.get(resolution.name);
        if (!accumulator) {
          accumulator = { importCount: 0, files: new Set(), languages: new Map() };
          externals.set(resolution.name, accumulator);
        }
        accumulator.importCount += 1;
        accumulator.files.add(file.path);
        accumulator.languages.set(
          file.language,
          (accumulator.languages.get(file.language) ?? 0) + 1,
        );
      } else {
        fileStats.unresolvedImports += 1;
      }
      refs.push(ref);
    }

    importsByPath.set(file.path, refs);
    statsByPath.set(file.path, fileStats);
    stats.importsFound += fileStats.importsFound;
    stats.importsResolved += fileStats.importsResolved;
    stats.externalImports += fileStats.externalImports;
    stats.unresolvedImports += fileStats.unresolvedImports;
  }

  const externalPackages: ExternalPackage[] = [...externals.entries()]
    .map(([name, accumulator]) => ({
      name,
      importCount: accumulator.importCount,
      fileCount: accumulator.files.size,
      language: mostCommonLanguage(accumulator.languages),
    }))
    .sort((a, b) => b.importCount - a.importCount || compareStrings(a.name, b.name));

  return {
    importsByPath,
    edges: [...edges.values()].sort((a, b) => compareStrings(a.id, b.id)),
    externalPackages,
    stats,
    statsByPath,
  };
}
