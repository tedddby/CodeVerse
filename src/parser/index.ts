/**
 * Tree-sitter based source parsing (symbols, imports, exports, packages).
 *
 * Environment-agnostic: nothing reachable from this module imports Node
 * built-ins (enforced by index.test.ts), so it runs on the server, in browsers
 * and in workers. Server code should use `getServerParser()` from
 * "@/parser/node"; browsers pair `createSourceParser` with `BrowserGrammarLoader`.
 *
 * Layout:
 * - `source-parser.ts`: the never-throwing `SourceParser` (limits, timeouts, failures);
 * - `runtime.ts`: web-tree-sitter initialization, grammar/parser/query caches;
 * - `registry.ts` + `languages/*`: one `LanguageModule` per grammar;
 * - `extract/*`: shared extraction helpers (builder, signatures, node utilities).
 */
import { LANGUAGE_MODULES } from "./registry";
import type { ParserLanguageId } from "./types";

export { createSourceParser, type SourceParser, type SourceParserInput } from "./source-parser";
export { countLines } from "./lines";
export type {
  GrammarLoader,
  ParseFailure,
  ParseFailureReason,
  ParseOptions,
  ParseOutcome,
  ParseResult,
  ParsedImport,
  ParsedSymbol,
  ParserLanguageId,
} from "./types";

export interface SupportedLanguage {
  id: ParserLanguageId;
  displayName: string;
  /** Grammar binary in public/grammars, e.g. "tree-sitter-python.wasm". */
  grammarFile: string;
  /** File extensions without the dot. */
  extensions: string[];
}

/** Languages with a registered parser, in registry order. */
export const SUPPORTED_LANGUAGES: ReadonlyArray<SupportedLanguage> = LANGUAGE_MODULES.map(
  (module) => ({
    id: module.id,
    displayName: module.displayName,
    grammarFile: module.grammarFile,
    extensions: [...module.extensions],
  }),
);
