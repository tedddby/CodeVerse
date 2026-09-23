/**
 * Test-only helpers: describe a miniature repository and resolve its imports.
 * Not imported by production code.
 */
import type { ImportKind, ImportRef } from "@/graph/model/types";
import { detectLanguage, parserLanguageFor } from "@/lib/languages/registry";
import type { ParsedImport } from "@/parser/types";
import { resolveDependencies } from "./index";
import type { DependencyInputFile, DependencyResolutionResult } from "./types";

export type ImportSpec = string | { specifier: string; kind?: ImportKind; names?: string[] };

export interface MiniRepository {
  /** Parsed source files and their imports. */
  sources: Record<string, ImportSpec[]>;
  /** Other files present in the repository tree (not parsed). */
  files?: string[];
  /** Resolution configs (also part of the tree). */
  configs?: Record<string, string>;
  /** Paths that exist in the tree but are not FileNodes. */
  omitted?: string[];
  /** Java/Go package declarations by path. */
  packages?: Record<string, string>;
}

export interface MiniRepositoryResult {
  result: DependencyResolutionResult;
  /** The ImportRef for a specifier imported by `path` (first match). */
  ref(path: string, specifier: string): ImportRef;
  /** Resolved target path of an import, null when unresolved/external. */
  target(path: string, specifier: string): string | null;
  /** Sorted "source -> target" pairs of all edges. */
  edgePairs(): string[];
}

function toParsedImport(spec: ImportSpec, index: number): ParsedImport {
  if (typeof spec === "string") return { specifier: spec, kind: "import", line: index + 1 };
  const parsed: ParsedImport = {
    specifier: spec.specifier,
    kind: spec.kind ?? "import",
    line: index + 1,
  };
  if (spec.names) parsed.names = spec.names;
  return parsed;
}

export function resolveMiniRepository(repository: MiniRepository): MiniRepositoryResult {
  const configs = repository.configs ?? {};
  const allPaths = new Set([
    ...Object.keys(repository.sources),
    ...(repository.files ?? []),
    ...Object.keys(configs),
  ]);
  const omitted = new Set(repository.omitted ?? []);
  const graphPaths = new Set([...allPaths].filter((path) => !omitted.has(path)));

  const files: DependencyInputFile[] = Object.entries(repository.sources).map(([path, imports]) => {
    const parserLanguage = parserLanguageFor(path);
    if (!parserLanguage) throw new Error(`No parser for test source ${path}`);
    const file: DependencyInputFile = {
      path,
      language: detectLanguage(path).id,
      parserLanguage,
      imports: imports.map(toParsedImport),
    };
    const packageName = repository.packages?.[path];
    if (packageName) file.packageName = packageName;
    return file;
  });

  const result = resolveDependencies({
    files,
    graphPaths,
    allPaths,
    configFiles: new Map(Object.entries(configs)),
  });

  const ref = (path: string, specifier: string): ImportRef => {
    const found = result.importsByPath
      .get(path)
      ?.find((candidate) => candidate.specifier === specifier);
    if (!found) throw new Error(`No import "${specifier}" in ${path}`);
    return found;
  };

  return {
    result,
    ref,
    target(path, specifier) {
      const resolved = ref(path, specifier).resolvedFileId;
      return resolved ? resolved.slice("file:".length) : null;
    },
    edgePairs() {
      return result.edges
        .map((edge) => `${edge.source.slice(5)} -> ${edge.target.slice(5)}`)
        .sort();
    },
  };
}
