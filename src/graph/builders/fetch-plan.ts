import type { AnalysisTier } from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import { isResolutionConfigFile } from "./config-files";
import type { FileInventory, InventoryFile } from "./inventory";
import { CATEGORY_RANK, areaOf, interleave, isAuxiliaryPath } from "./priority";
import { compareStrings, compareTuples } from "./sort";

/**
 * Stage 2: decide which file contents to download, and why the rest is skipped.
 *
 * Every graph file ends up in exactly one of `parseFiles`, `contentOnlyFiles`
 * or `skipped`. `configFiles` is orthogonal: it lists manifests the dependency
 * resolvers need (they may or may not be graph files) and may overlap the
 * other two lists — the pipeline downloads the union once. Graph files that are
 * config files are always analysed, because their content is downloaded anyway.
 */

export type SkipReason =
  /** Parseable, but the parse budget for this tier was exhausted. */
  | "parse-limit"
  /** Larger than the parse limit (and not line-counted) or larger than `maxFileBytes`. */
  | "size-limit"
  /** The total download budget (`maxTotalBytes`) was exhausted. */
  | "byte-budget"
  /** Generated, minified, lockfile or vendored. */
  | "generated"
  | "binary"
  /** No parser for the language and too large to line-count. */
  | "not-parseable"
  /** Could be line-counted, but falls outside the content sample for this tier. */
  | "not-selected";

export interface FetchPlan {
  /** Resolution configs (package.json, tsconfig*.json, go.mod, ...), shallowest first. */
  configFiles: string[];
  /** Graph files to download and parse, most important first. */
  parseFiles: string[];
  /** Graph files to download for line counting only. */
  contentOnlyFiles: string[];
  /** Why each remaining graph file is not downloaded (sorted by path). */
  skipped: Map<string, SkipReason>;
  /** Graph files that would be parsed if the parse budget were unlimited. */
  eligibleParseFiles: number;
}

/** Resolution configs larger than this are ignored (real manifests are far smaller). */
export const CONFIG_FILE_MAX_BYTES = 256 * 1024;
/** Maximum number of resolution configs downloaded. */
export const MAX_CONFIG_FILES = 300;
/** Files without a parser are only line-counted when at most this large. */
export const CONTENT_ONLY_MAX_BYTES = 64 * 1024;

const CONTENT_ONLY_BUDGET: Readonly<Record<AnalysisTier, number>> = {
  full: 1_500,
  progressive: 300,
  "directory-first": 0,
};

const DIRECTORY_FIRST_PARSE_CAP = 500;

/** Maximum number of files parsed for a tier. */
export function parseBudgetFor(tier: AnalysisTier, limits: AnalysisLimits): number {
  const max = Math.max(0, Math.floor(limits.maxParsedFiles));
  return tier === "directory-first" ? Math.min(max, DIRECTORY_FIRST_PARSE_CAP) : max;
}

/** Maximum number of files downloaded for line counting only (config files excluded). */
export function contentOnlyBudgetFor(tier: AnalysisTier): number {
  return CONTENT_ONLY_BUDGET[tier];
}

function byDepthThenPath(a: InventoryFile, b: InventoryFile): number {
  return compareTuples([a.depth, a.path], [b.depth, b.path]);
}

/**
 * 0: core source, 1: auxiliary source (examples, scripts, docs) and parseable
 * config/build files, 2: tests.
 */
function parseClassOf(file: InventoryFile): number {
  if (file.category === "test") return 2;
  if (file.category === "source" && !isAuxiliaryPath(file.path)) return 0;
  return 1;
}

/**
 * Orders parse candidates: config files first (already downloaded), then each
 * class with areas interleaved round-robin, so a limited budget covers every
 * package of a monorepo instead of the alphabetically first ones. Inside an
 * area, shallower files come first.
 */
function orderParseCandidates(
  candidates: readonly InventoryFile[],
  configSet: ReadonlySet<string>,
): InventoryFile[] {
  const ordered = candidates.filter((file) => configSet.has(file.path)).sort(byDepthThenPath);
  const classes: Array<Map<string, InventoryFile[]>> = [new Map(), new Map(), new Map()];
  for (const file of candidates) {
    if (configSet.has(file.path)) continue;
    const areas = classes[parseClassOf(file)];
    if (!areas) continue;
    const area = areaOf(file.path);
    const list = areas.get(area);
    if (list) list.push(file);
    else areas.set(area, [file]);
  }
  for (const areas of classes) {
    const groups = [...areas.keys()]
      .sort(compareStrings)
      .map((area) => (areas.get(area) ?? []).sort(byDepthThenPath));
    ordered.push(...interleave(groups));
  }
  return ordered;
}

function byContentPriority(a: InventoryFile, b: InventoryFile): number {
  return compareTuples(
    [CATEGORY_RANK[a.category], a.depth, a.path],
    [CATEGORY_RANK[b.category], b.depth, b.path],
  );
}

/** Plans content downloads for the graph files of an inventory. Pure and deterministic. */
export function planContentFetch(
  inventory: FileInventory,
  graphFiles: ReadonlySet<string>,
  tier: AnalysisTier,
  limits: AnalysisLimits,
): FetchPlan {
  const maxTotalBytes = Math.max(0, limits.maxTotalBytes);
  const downloaded = new Set<string>();
  let plannedBytes = 0;
  /** Reserves download bytes for a file; files already reserved are free. */
  const reserve = (file: InventoryFile): boolean => {
    if (downloaded.has(file.path)) return true;
    if (plannedBytes + file.size > maxTotalBytes) return false;
    plannedBytes += file.size;
    downloaded.add(file.path);
    return true;
  };

  // 1. Resolution configs — needed even when they are not graph files.
  const configFiles: string[] = [];
  const configCandidates = inventory.files
    .filter(
      (file) =>
        isResolutionConfigFile(file.path) &&
        file.category !== "vendor" &&
        !file.isBinary &&
        file.size <= CONFIG_FILE_MAX_BYTES,
    )
    .sort(byDepthThenPath);
  for (const file of configCandidates) {
    if (configFiles.length >= MAX_CONFIG_FILES) break;
    if (reserve(file)) configFiles.push(file.path);
  }
  const configSet = new Set(configFiles);

  // 2. Classify graph files.
  const reasons = new Map<string, SkipReason>();
  const parseCandidates: InventoryFile[] = [];
  const oversizedSource: InventoryFile[] = [];
  const textCandidates: InventoryFile[] = [];
  const freeContent: InventoryFile[] = [];
  const graphInventory = inventory.files.filter((file) => graphFiles.has(file.path));
  const textLimit = Math.min(CONTENT_ONLY_MAX_BYTES, limits.maxFileBytes);

  for (const file of graphInventory) {
    if (file.isBinary) reasons.set(file.path, "binary");
    else if (file.isGenerated || file.category === "vendor") reasons.set(file.path, "generated");
    else if (file.parserLanguage !== null) {
      if (file.size <= limits.maxParseBytes) parseCandidates.push(file);
      else if (configSet.has(file.path)) freeContent.push(file);
      else if (file.size <= limits.maxFileBytes) oversizedSource.push(file);
      else reasons.set(file.path, "size-limit");
    } else if (configSet.has(file.path)) freeContent.push(file);
    else if (file.size <= textLimit) textCandidates.push(file);
    else reasons.set(file.path, "not-parseable");
  }

  // 3. Parse selection within the tier budget and the byte budget.
  const parseBudget = parseBudgetFor(tier, limits);
  const parseFiles: string[] = [];
  for (const file of orderParseCandidates(parseCandidates, configSet)) {
    if (parseFiles.length >= parseBudget) {
      if (configSet.has(file.path)) freeContent.push(file);
      else reasons.set(file.path, "parse-limit");
    } else if (reserve(file)) parseFiles.push(file.path);
    else reasons.set(file.path, "byte-budget");
  }

  // 4. Line counting: free config files first, then oversized source, then small text files.
  const contentOnlyFiles = freeContent.sort(byDepthThenPath).map((file) => file.path);
  const contentBudget = contentOnlyBudgetFor(tier);
  let contentDownloads = 0;
  const contentCandidates = [
    ...oversizedSource.sort(byDepthThenPath),
    ...textCandidates.sort(byContentPriority),
  ];
  for (const file of contentCandidates) {
    if (contentDownloads >= contentBudget) {
      reasons.set(file.path, file.parserLanguage !== null ? "size-limit" : "not-selected");
    } else if (reserve(file)) {
      contentOnlyFiles.push(file.path);
      contentDownloads += 1;
    } else reasons.set(file.path, "byte-budget");
  }

  const skipped = new Map<string, SkipReason>();
  for (const file of graphInventory) {
    const reason = reasons.get(file.path);
    if (reason) skipped.set(file.path, reason);
  }

  return {
    configFiles,
    parseFiles,
    contentOnlyFiles,
    skipped,
    eligibleParseFiles: parseCandidates.length,
  };
}
