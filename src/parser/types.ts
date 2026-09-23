import type { ImportKind, SymbolKind } from "@/graph/model/types";
import type { ParserLanguageId } from "@/lib/languages/registry";

export type { ParserLanguageId };

/**
 * Output of parsing a single source file. Produced by `parseSource()` and
 * consumed by graph builders. Contains no source text beyond short signatures.
 */
export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  exported: boolean;
  /** Index into `ParseResult.symbols` of the enclosing symbol (methods inside classes, etc). */
  parentIndex?: number;
  /** Single-line, whitespace-collapsed declaration head, max 160 chars. */
  signature?: string;
}

export interface ParsedImport {
  /** Raw specifier ("./jwt", "react", ".models", "os.path", "com.acme.Foo", "fmt", "crate::a::b"). */
  specifier: string;
  kind: ImportKind;
  /** 1-based line. */
  line: number;
  /** Imported binding names when cheaply available ("*" for namespace/wildcard). */
  names?: string[];
}

export interface ParseResult {
  language: ParserLanguageId;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  /** Exported names (best-effort; Python/Go/Rust use language visibility rules). */
  exports: string[];
  /** Total lines in the file. */
  lines: number;
  /** True when the syntax tree contains ERROR/MISSING nodes (extraction is best-effort). */
  hasErrors: boolean;
  /** Java `package x.y;` / Go `package x` declarations. */
  packageName?: string;
  durationMs: number;
}

export type ParseFailureReason = "timeout" | "grammar-unavailable" | "parser-crash" | "too-large";

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  message: string;
  lines: number;
}

export type ParseOutcome = ({ ok: true } & ParseResult) | ParseFailure;

export interface ParseOptions {
  /** Abort parsing of this file after this many milliseconds. */
  timeoutMs?: number;
  /** Refuse to parse content longer than this many bytes (UTF-8). */
  maxBytes?: number;
}

/**
 * Loads WebAssembly binaries for the tree-sitter runtime and grammars.
 * Node reads them from disk; browsers/workers fetch them from /grammars/.
 */
export interface GrammarLoader {
  /** Bytes of web-tree-sitter.wasm. */
  loadRuntime(): Promise<Uint8Array>;
  /** Bytes of a grammar file, e.g. "tree-sitter-python.wasm". */
  loadGrammar(fileName: string): Promise<Uint8Array>;
}
