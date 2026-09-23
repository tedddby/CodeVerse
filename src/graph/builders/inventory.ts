import { parentPath } from "@/graph/model/ids";
import type { AnalysisTier, FileCategory } from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import {
  detectCategory,
  detectLanguage,
  isBinaryPath,
  isGeneratedPath,
  parserLanguageFor,
  type ParserLanguageId,
} from "@/lib/languages/registry";
import type { SourceTree } from "@/sources/types";
import { compareStrings, directoryDepthOf } from "./sort";

export { isResolutionConfigFile } from "./config-files";
export { selectGraphFiles } from "./selection";
export {
  planContentFetch,
  parseBudgetFor,
  CONTENT_ONLY_MAX_BYTES,
  CONFIG_FILE_MAX_BYTES,
  MAX_CONFIG_FILES,
  type FetchPlan,
  type SkipReason,
} from "./fetch-plan";

/**
 * Stage 1 of graph construction: classify every file of the repository tree.
 *
 * The inventory is the single source of truth for "what exists in the
 * repository" — directory totals, language shares and coverage numbers are all
 * computed from it, even for files that never become buildings.
 */

export interface InventoryFile {
  path: string;
  /** Size in bytes (0 when the provider did not report one). */
  size: number;
  /** Display language id from the registry ("unknown" when unrecognized). */
  language: string;
  /** Tree-sitter grammar for the file, or null when it cannot be parsed. */
  parserLanguage: ParserLanguageId | null;
  category: FileCategory;
  /** Lockfiles, minified bundles, vendored or generated code. */
  isGenerated: boolean;
  isBinary: boolean;
  /** Depth of the containing directory (0 for files at the repository root). */
  depth: number;
}

export interface FileInventory {
  /** Every regular file, sorted by path. */
  files: InventoryFile[];
  /** Every directory path that contains files (including the root ""), sorted. */
  directories: string[];
  /** Tree entries that are not regular files and are left out of the universe. */
  excluded: { submodules: number; symlinks: number };
  totalBytes: number;
  /** True when the provider could not list every entry. */
  truncated: boolean;
}

/** Rejects paths the graph cannot represent (empty, absolute, "." / ".." or empty segments). */
function isRepresentablePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function sanitizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
}

/** Classifies every regular file of a source tree. Pure and deterministic. */
export function buildInventory(tree: SourceTree): FileInventory {
  const byPath = new Map<string, InventoryFile>();
  let submodules = 0;
  let symlinks = 0;

  for (const entry of tree.entries) {
    if (entry.type === "submodule") {
      submodules += 1;
      continue;
    }
    if (entry.type === "symlink") {
      symlinks += 1;
      continue;
    }
    if (entry.type !== "file" || !isRepresentablePath(entry.path) || byPath.has(entry.path)) {
      continue;
    }
    const language = detectLanguage(entry.path);
    byPath.set(entry.path, {
      path: entry.path,
      size: sanitizeSize(entry.size),
      language: language.id,
      parserLanguage: parserLanguageFor(entry.path),
      category: detectCategory(entry.path, language),
      isGenerated: isGeneratedPath(entry.path),
      isBinary: isBinaryPath(entry.path),
      depth: directoryDepthOf(entry.path),
    });
  }

  const files = [...byPath.values()].sort((a, b) => compareStrings(a.path, b.path));
  const directories = new Set<string>([""]);
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    let directory = parentPath(file.path);
    while (!directories.has(directory)) {
      directories.add(directory);
      directory = parentPath(directory);
    }
  }

  return {
    files,
    directories: [...directories].sort(compareStrings),
    excluded: { submodules, symlinks },
    totalBytes,
    truncated: tree.truncated,
  };
}

/**
 * Picks the analysis tier for a repository with `fileCount` files:
 * full (<= tierFullMax), progressive (<= tierProgressiveMax), else directory-first.
 */
export function determineTier(fileCount: number, limits: AnalysisLimits): AnalysisTier {
  if (fileCount <= limits.tierFullMax) return "full";
  if (fileCount <= limits.tierProgressiveMax) return "progressive";
  return "directory-first";
}
