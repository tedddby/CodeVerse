import type { Node, Query } from "web-tree-sitter";
import type { Deadline } from "@/parser/deadline";
import type { ParsedImport, ParsedSymbol, ParserLanguageId } from "@/parser/types";

/** Everything a language module may use while extracting from one syntax tree. */
export interface ExtractionContext {
  /** Text exactly as parsed (byte order mark removed). Node indices are UTF-16 offsets into it. */
  readonly source: string;
  /** Per-file budget; walkers call `tick()` per visited node. */
  readonly deadline: Deadline;
  /**
   * Runs the module's query `name` over `node` and returns its captures in
   * document order. Honors the deadline (throws `ParseTimeoutError`).
   */
  captures(name: string, node: Node): QueryCaptureList;
}

export type QueryCaptureList = ReturnType<Query["captures"]>;

/** Language-specific output; the parser adds timing, line counts and error flags. */
export interface Extraction {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  exports: string[];
  packageName?: string;
}

/**
 * Node types and field names a module references. Tests validate every entry
 * against the real grammar so a typo or grammar upgrade cannot silently turn
 * an extraction branch into dead code.
 */
export interface GrammarVocabulary {
  readonly nodeTypes: readonly string[];
  readonly fields: readonly string[];
}

/**
 * One tree-sitter language. Supporting a new language means writing one module
 * implementing this interface and registering it in `src/parser/registry.ts`.
 */
export interface LanguageModule {
  readonly id: ParserLanguageId;
  readonly displayName: string;
  /** File name of the grammar, e.g. "tree-sitter-python.wasm". */
  readonly grammarFile: string;
  /** File extensions (without dot) routed to this module. */
  readonly extensions: readonly string[];
  readonly vocabulary: GrammarVocabulary;
  /** Named tree-sitter query sources, compiled once per grammar on first use. */
  readonly queries?: Readonly<Record<string, string>>;
  /** Extracts symbols, imports and exports. May throw; the parser turns throws into failures. */
  extract(root: Node, context: ExtractionContext): Extraction;
}
