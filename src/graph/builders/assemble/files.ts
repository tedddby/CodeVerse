import {
  baseName,
  directoryId,
  extensionOf,
  fileId,
  parentPath,
  symbolId,
} from "@/graph/model/ids";
import type {
  AnalysisTier,
  FileActivity,
  FileAnalysisStatus,
  FileNode,
  ImportRef,
  SymbolNode,
} from "@/graph/model/types";
import type { AnalysisLimits } from "@/lib/config/limits";
import { formatBytes } from "@/lib/utils/format";
import type { ParseResult } from "@/parser/types";
import type { DependencyResolutionResult, ImportStats } from "../dependencies";
import type { FetchPlan } from "../fetch-plan";
import type { InventoryFile } from "../inventory";
import { estimateLines } from "../line-estimate";
import {
  BINARY_STATUS_REASON,
  PREVIEW_STATUS_REASON,
  UNPROCESSED_STATUS_REASON,
  skipReasonMessage,
} from "./status-reasons";
import type { FileAnalysisResult } from "./types";

/**
 * FileNode and SymbolNode construction for graph files.
 */

const MAX_SIGNATURE_LENGTH = 160;

export interface FileBuildInput {
  /** Graph files, sorted by path. */
  files: readonly InventoryFile[];
  analyses: ReadonlyMap<string, FileAnalysisResult>;
  fetchPlan: FetchPlan | null;
  dependencies: DependencyResolutionResult | null;
  activity: ReadonlyMap<string, FileActivity>;
  tier: AnalysisTier;
  limits: AnalysisLimits;
  /** Structure-only preview: every non-binary file is metadata-only "in progress". */
  preview: boolean;
}

export interface BuiltFiles {
  files: FileNode[];
  symbols: SymbolNode[];
  importStats: ImportStats;
}

/** Collapses whitespace and truncates to 160 characters (with an ellipsis). */
export function normalizeSignature(signature: string | undefined): string | undefined {
  if (typeof signature !== "string") return undefined;
  const collapsed = signature.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length > MAX_SIGNATURE_LENGTH
    ? `${collapsed.slice(0, MAX_SIGNATURE_LENGTH - 1)}…`
    : collapsed;
}

function sanitizeLine(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** Symbols of one file: duplicate ids dropped, parents linked, sorted in source order. */
export function buildSymbols(path: string, parse: ParseResult): SymbolNode[] {
  const owner = fileId(path);
  const idByIndex: Array<string | undefined> = [];
  const nodes: Array<{ node: SymbolNode; parentIndex?: number; order: number }> = [];
  const seen = new Set<string>();

  parse.symbols.forEach((symbol, index) => {
    const name = typeof symbol.name === "string" ? symbol.name.trim() : "";
    if (name === "") return;
    const startLine = sanitizeLine(symbol.startLine);
    const endLine = Math.max(startLine, sanitizeLine(symbol.endLine));
    const id = symbolId(path, name, startLine);
    idByIndex[index] = id;
    if (seen.has(id)) return;
    seen.add(id);
    const node: SymbolNode = {
      id,
      name,
      kind: symbol.kind,
      fileId: owner,
      startLine,
      endLine,
      exported: symbol.exported === true,
    };
    const signature = normalizeSignature(symbol.signature);
    if (signature !== undefined) node.signature = signature;
    nodes.push({ node, parentIndex: symbol.parentIndex, order: index });
  });

  for (const entry of nodes) {
    if (entry.parentIndex === undefined) continue;
    const parentId = idByIndex[entry.parentIndex];
    if (parentId !== undefined && parentId !== entry.node.id) entry.node.parentSymbolId = parentId;
  }

  return nodes
    .sort(
      (a, b) =>
        a.node.startLine - b.node.startLine || b.node.endLine - a.node.endLine || a.order - b.order,
    )
    .map((entry) => entry.node);
}

function defaultStatusReason(
  status: FileAnalysisStatus,
  file: InventoryFile,
  limits: AnalysisLimits,
): string | undefined {
  switch (status) {
    case "parsed":
      return undefined;
    case "partial":
      return "Parsed with syntax errors; symbols and imports may be incomplete";
    case "content-only":
      return file.parserLanguage !== null
        ? `Larger than the ${formatBytes(limits.maxParseBytes)} parse limit; lines counted only`
        : "Language not supported for parsing; lines counted only";
    case "metadata-only":
      return UNPROCESSED_STATUS_REASON;
    case "binary":
      return BINARY_STATUS_REASON;
    case "failed":
      return "Analysis failed for this file";
  }
}

function unresolvedRefs(parse: ParseResult | undefined): ImportRef[] {
  return (parse?.imports ?? []).map((imported) => ({
    specifier: imported.specifier,
    kind: imported.kind,
    line: imported.line,
    external: false,
  }));
}

function uniqueExports(parse: ParseResult | undefined): string[] {
  const exports: string[] = [];
  const seen = new Set<string>();
  for (const name of parse?.exports ?? []) {
    if (typeof name !== "string" || name === "" || seen.has(name)) continue;
    seen.add(name);
    exports.push(name);
  }
  return exports;
}

interface LineInfo {
  lines: number;
  linesEstimated: boolean;
}

function estimated(file: InventoryFile): LineInfo {
  return { lines: estimateLines(file.size, file.language), linesEstimated: file.size > 0 };
}

export function buildFiles(input: FileBuildInput): BuiltFiles {
  const files: FileNode[] = [];
  const symbols: SymbolNode[] = [];
  const importStats: ImportStats = {
    importsFound: 0,
    importsResolved: 0,
    externalImports: 0,
    unresolvedImports: 0,
  };

  const graphIds = new Set(input.files.map((file) => fileId(file.path)));
  /** Copies a ref, dropping a resolved target that is not a FileNode of this graph. */
  const copyRef = (ref: ImportRef): ImportRef => {
    const copy: ImportRef = {
      specifier: ref.specifier,
      kind: ref.kind,
      line: ref.line,
      external: ref.external,
    };
    if (ref.resolvedFileId !== undefined && graphIds.has(ref.resolvedFileId)) {
      copy.resolvedFileId = ref.resolvedFileId;
    }
    return copy;
  };

  for (const file of input.files) {
    const analysis = input.preview ? undefined : input.analyses.get(file.path);
    let status: FileAnalysisStatus;
    let statusReason: string | undefined;
    let lineInfo: LineInfo;

    if (analysis) {
      status = analysis.status;
      const reason = analysis.statusReason?.trim();
      statusReason = reason ? reason : defaultStatusReason(status, file, input.limits);
      const exact = analysis.lines ?? analysis.parse?.lines;
      if (status === "binary") lineInfo = { lines: 0, linesEstimated: false };
      else if (typeof exact === "number" && Number.isFinite(exact) && exact >= 0) {
        lineInfo = { lines: Math.floor(exact), linesEstimated: false };
      } else lineInfo = estimated(file);
    } else if (file.isBinary) {
      status = "binary";
      statusReason = BINARY_STATUS_REASON;
      lineInfo = { lines: 0, linesEstimated: false };
    } else {
      status = "metadata-only";
      const skipReason = input.fetchPlan?.skipped.get(file.path);
      statusReason = input.preview
        ? PREVIEW_STATUS_REASON
        : skipReason
          ? skipReasonMessage(skipReason, file.size, input.tier, input.limits)
          : UNPROCESSED_STATUS_REASON;
      lineInfo = estimated(file);
    }

    const parse = analysis?.parse;
    const fileSymbols = parse ? buildSymbols(file.path, parse) : [];
    // A loop instead of push(...spread): generated files can declare tens of thousands of symbols.
    for (const symbol of fileSymbols) symbols.push(symbol);

    const resolved = input.dependencies?.importsByPath.get(file.path);
    const imports = resolved ?? unresolvedRefs(parse);
    const stats = resolved ? input.dependencies?.statsByPath.get(file.path) : undefined;
    importStats.importsFound += imports.length;
    if (stats) {
      importStats.importsResolved += stats.importsResolved;
      importStats.externalImports += stats.externalImports;
      importStats.unresolvedImports += stats.unresolvedImports;
    } else {
      const external = imports.filter((ref) => ref.external).length;
      const internal = imports.filter((ref) => ref.resolvedFileId !== undefined).length;
      importStats.importsResolved += internal;
      importStats.externalImports += external;
      importStats.unresolvedImports += imports.length - internal - external;
    }

    const node: FileNode = {
      id: fileId(file.path),
      path: file.path,
      name: baseName(file.path),
      extension: extensionOf(baseName(file.path)),
      language: file.language,
      category: file.category,
      size: file.size,
      lines: lineInfo.lines,
      linesEstimated: lineInfo.linesEstimated,
      directoryId: directoryId(parentPath(file.path)),
      symbolIds: fileSymbols.map((symbol) => symbol.id),
      imports: imports.map(copyRef),
      exports: uniqueExports(parse),
      status,
      isGenerated: file.isGenerated,
    };
    if (statusReason !== undefined) node.statusReason = statusReason;
    const activity = input.activity.get(file.path);
    if (activity) node.activity = activity;
    files.push(node);
  }

  return { files, symbols, importStats };
}
