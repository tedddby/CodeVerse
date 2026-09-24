import type { BadgeTone } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type {
  DirectoryNode,
  FileAnalysisStatus,
  FileNode,
  NodeRef,
  SymbolKind,
  SymbolNode,
} from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { formatInteger, pluralize } from "@/lib/utils/format";

/**
 * Pure, user-facing descriptions of graph nodes shared by the selection panel,
 * the screen-reader announcer and share previews.
 */

export const SYMBOL_KIND_LABELS: Record<SymbolKind, { singular: string; plural: string }> = {
  class: { singular: "class", plural: "Classes" },
  interface: { singular: "interface", plural: "Interfaces" },
  struct: { singular: "struct", plural: "Structs" },
  trait: { singular: "trait", plural: "Traits" },
  enum: { singular: "enum", plural: "Enums" },
  type: { singular: "type", plural: "Types" },
  function: { singular: "function", plural: "Functions" },
  method: { singular: "method", plural: "Methods" },
  constant: { singular: "constant", plural: "Constants" },
  variable: { singular: "variable", plural: "Variables" },
  module: { singular: "module", plural: "Modules" },
};

/** Display order of symbol groups in the selection panel. */
export const SYMBOL_KIND_ORDER: readonly SymbolKind[] = [
  "class",
  "interface",
  "struct",
  "trait",
  "enum",
  "type",
  "function",
  "method",
  "constant",
  "variable",
  "module",
];

export interface FileStatusCopy {
  label: string;
  tone: BadgeTone;
  /** Explains what the status means for the numbers shown. */
  explanation: string;
}

export const FILE_STATUS_COPY: Record<FileAnalysisStatus, FileStatusCopy> = {
  parsed: {
    label: "Parsed",
    tone: "ok",
    explanation: "Source was parsed; symbols and imports are extracted.",
  },
  partial: {
    label: "Partially parsed",
    tone: "warn",
    explanation:
      "The parser hit syntax it could not understand; symbols and imports may be incomplete.",
  },
  "content-only": {
    label: "Not parsed",
    tone: "neutral",
    explanation: "Lines were counted, but CodeVerse has no parser for this language yet.",
  },
  "metadata-only": {
    label: "Metadata only",
    tone: "warn",
    explanation:
      "Content was not downloaded because of analysis limits; the line count is estimated from the file size.",
  },
  binary: {
    label: "Binary",
    tone: "neutral",
    explanation: "Binary files are never downloaded or parsed.",
  },
  failed: {
    label: "Analysis failed",
    tone: "danger",
    explanation: "The file could not be downloaded or parsed.",
  },
};

export function languageName(languageId: string): string {
  return getLanguage(languageId).name;
}

/** Display name of a directory; the root directory shows the repository name. */
export function directoryDisplayName(directory: DirectoryNode, index: GraphIndex | null): string {
  if (directory.path === "") return index?.graph.repository.name ?? directory.name;
  return directory.name;
}

/** Display path of a directory ("/" for the root). */
export function directoryDisplayPath(directory: DirectoryNode): string {
  return directory.path === "" ? "/" : directory.path;
}

/** "TypeScript · 842 lines" (binary files show no line count). */
export function fileSummaryLine(file: FileNode): string {
  const language = languageName(file.language);
  if (file.status === "binary") return `${language} · binary`;
  return `${language} · ${pluralize(file.lines, "line")}`;
}

export interface FileSymbolCounts {
  functions: number;
  classes: number;
  total: number;
}

export function countFileSymbols(file: FileNode, index: GraphIndex): FileSymbolCounts {
  let functions = 0;
  let classes = 0;
  for (const id of file.symbolIds) {
    const symbol = index.symbolsById.get(id);
    if (!symbol) continue;
    if (symbol.kind === "function" || symbol.kind === "method") functions += 1;
    else if (symbol.kind === "class" || symbol.kind === "struct") classes += 1;
  }
  return { functions, classes, total: file.symbolIds.length };
}

/** Distinct files importing `fileId`. */
export function dependentFileIds(fileId: string, index: GraphIndex): string[] {
  const edges = index.dependenciesByTarget.get(fileId) ?? [];
  return [...new Set(edges.map((edge) => edge.source))];
}

/** "lines 44–120" or "line 3". */
export function lineRangeLabel(symbol: Pick<SymbolNode, "startLine" | "endLine">): string {
  return symbol.endLine > symbol.startLine
    ? `lines ${formatInteger(symbol.startLine)}–${formatInteger(symbol.endLine)}`
    : `line ${formatInteger(symbol.startLine)}`;
}

/**
 * Sentence announced to screen readers when the selection changes, e.g.
 * "Selected file src/auth/auth.ts, TypeScript, 842 lines". Empty when nothing
 * is selected or the node no longer exists.
 */
export function describeSelection(selection: NodeRef | null, index: GraphIndex | null): string {
  if (!selection || !index) return "";
  switch (selection.kind) {
    case "file": {
      const file = index.filesById.get(selection.id);
      if (!file) return "";
      const lines = file.status === "binary" ? "binary file" : pluralize(file.lines, "line");
      return `Selected file ${file.path}, ${languageName(file.language)}, ${lines}${file.linesEstimated ? " (estimated)" : ""}`;
    }
    case "directory": {
      const directory = index.directoriesById.get(selection.id);
      if (!directory) return "";
      const name =
        directory.path === ""
          ? `repository root ${index.graph.repository.fullName}`
          : `directory ${directory.path}`;
      return `Selected ${name}, ${pluralize(directory.stats.fileCount, "file")}`;
    }
    case "symbol": {
      const symbol = index.symbolsById.get(selection.id);
      if (!symbol) return "";
      const file = index.filesById.get(symbol.fileId);
      const where = file ? ` in ${file.path}` : "";
      return `Selected ${SYMBOL_KIND_LABELS[symbol.kind].singular} ${symbol.name}${where}, ${lineRangeLabel(symbol)}`;
    }
  }
}

/** Only avatars served by GitHub's avatar CDN are rendered (matches the CSP img-src). */
export function isTrustedAvatarUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "avatars.githubusercontent.com";
  } catch {
    return false;
  }
}

/** Initials for avatar placeholders ("Ada Octo" -> "AO"). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? [words[0], words[words.length - 1]] : [words[0] ?? "?"];
  return (
    letters
      .map((word) => Array.from(word ?? "")[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}
