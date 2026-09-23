import type { DependencyEdge, ExternalPackage, ImportRef } from "@/graph/model/types";
import type { ParsedImport } from "@/parser/types";
import type { ParserLanguageId } from "@/lib/languages/registry";

/** A parsed file whose imports should be resolved. */
export interface DependencyInputFile {
  path: string;
  /** Display language id ("typescript" for .ts/.tsx, "python", ...). */
  language: string;
  parserLanguage: ParserLanguageId;
  imports: ParsedImport[];
  /** Java `package` / Go `package` declaration from the parse result. */
  packageName?: string;
}

export interface DependencyResolutionInput {
  files: DependencyInputFile[];
  /** Paths that are FileNodes: edges may only target these. */
  graphPaths: ReadonlySet<string>;
  /** Every file path in the repository tree (used to probe for targets). */
  allPaths: ReadonlySet<string>;
  /** Resolution config contents by path (package.json, tsconfig*.json, go.mod, Cargo.toml, ...). */
  configFiles: ReadonlyMap<string, string>;
}

/** Per-file import tallies (the four counts always add up: found = resolved + external + unresolved). */
export interface ImportStats {
  importsFound: number;
  importsResolved: number;
  externalImports: number;
  unresolvedImports: number;
}

export interface DependencyResolutionResult {
  /** One ImportRef per ParsedImport, in source order, keyed by importer path. */
  importsByPath: Map<string, ImportRef[]>;
  /** File-to-file edges aggregated per (source, target, kind), sorted by id. */
  edges: DependencyEdge[];
  /** Sorted by importCount desc, then name. */
  externalPackages: ExternalPackage[];
  stats: ImportStats;
  /**
   * Tallies per importer path. Needed because an import that resolves to a
   * repository file which is not a FileNode is "resolved" but its ImportRef
   * carries no `resolvedFileId`, so it cannot be told apart from an unresolved one.
   */
  statsByPath: Map<string, ImportStats>;
}

/** Outcome of resolving one import. */
export type Resolution =
  /** Repository paths the import refers to (existing files; the first is the representative). */
  | { type: "internal"; paths: string[] }
  /** Third-party package or standard library module, by normalized name. */
  | { type: "external"; name: string }
  /** Looks internal (relative, aliased, ...) but no matching file exists. */
  | { type: "unresolved" };

export const UNRESOLVED: Resolution = { type: "unresolved" };

export function internal(paths: readonly string[]): Resolution {
  return paths.length > 0 ? { type: "internal", paths: [...paths] } : UNRESOLVED;
}

export function external(name: string): Resolution {
  return { type: "external", name };
}

/** Shared, precomputed view of the repository used by every language resolver. */
export interface ResolverContext {
  allPaths: ReadonlySet<string>;
  graphPaths: ReadonlySet<string>;
  configFiles: ReadonlyMap<string, string>;
  /** Files directly inside each directory (from `allPaths`), sorted. */
  filesByDirectory: ReadonlyMap<string, readonly string[]>;
  /** Every input file, sorted by path. */
  files: readonly DependencyInputFile[];
}

export interface LanguageResolver {
  resolve(file: DependencyInputFile, imported: ParsedImport): Resolution;
}
