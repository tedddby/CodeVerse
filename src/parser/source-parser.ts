import type { Language } from "web-tree-sitter";
import { Deadline, ParseTimeoutError } from "./deadline";
import type { ExtractionContext, LanguageModule } from "./languages/types";
import { countLines } from "./lines";
import { LANGUAGE_MODULES, getLanguageModule } from "./registry";
import { TreeSitterRuntime } from "./runtime";
import type {
  GrammarLoader,
  ParseFailure,
  ParseFailureReason,
  ParseOptions,
  ParseOutcome,
  ParserLanguageId,
} from "./types";
import { exceedsUtf8Bytes, stripByteOrderMark } from "./utf8";

export interface SourceParserInput {
  /**
   * Repository-relative path. Identifies the file for callers; parsing depends
   * only on `content` and `language` (content is never executed).
   */
  path: string;
  content: string;
  language: ParserLanguageId;
}

/** Parses source files into symbols, imports and exports. Safe to share across concurrent callers. */
export interface SourceParser {
  /** Never throws: every problem becomes a `{ ok: false }` outcome with a reason. */
  parse(input: SourceParserInput, options?: ParseOptions): Promise<ParseOutcome>;
  /**
   * Loads the runtime and the given grammars (all by default) ahead of time.
   * Never rejects: grammars that fail to load are reported per file by `parse`.
   */
  warmup(languages?: ParserLanguageId[]): Promise<void>;
}

/** Longest error detail copied into a failure message. */
const MAX_DETAIL_LENGTH = 200;

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const singleLine = message.replace(/\s+/g, " ").trim() || "unknown error";
  return singleLine.length > MAX_DETAIL_LENGTH
    ? `${singleLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : singleLine;
}

function failure(reason: ParseFailureReason, message: string, lines: number): ParseFailure {
  return { ok: false, reason, message, lines };
}

function roundDuration(milliseconds: number): number {
  return Math.round(milliseconds * 100) / 100;
}

class TreeSitterSourceParser implements SourceParser {
  private readonly runtime: TreeSitterRuntime;

  constructor(loader: GrammarLoader) {
    this.runtime = new TreeSitterRuntime(loader);
  }

  async parse(input: SourceParserInput, options: ParseOptions = {}): Promise<ParseOutcome> {
    let lines = 0;
    try {
      const content = input.content;
      if (typeof content !== "string") {
        return failure("parser-crash", "File content is not text", 0);
      }
      lines = countLines(content);
      const { maxBytes } = options;
      if (
        maxBytes !== undefined &&
        Number.isFinite(maxBytes) &&
        exceedsUtf8Bytes(content, maxBytes)
      ) {
        return failure("too-large", `File is larger than the ${maxBytes}-byte parse limit`, lines);
      }
      const languageModule = getLanguageModule(input.language);
      if (!languageModule) {
        const requested = String(input.language).slice(0, 40);
        return failure("grammar-unavailable", `No parser is available for "${requested}"`, lines);
      }
      let language: Language;
      try {
        language = await this.runtime.loadLanguage(languageModule.grammarFile);
      } catch (error) {
        return failure(
          "grammar-unavailable",
          `The ${languageModule.displayName} grammar could not be loaded: ${describeError(error)}`,
          lines,
        );
      }
      return this.parseLoaded(input, languageModule, language, content, lines, options);
    } catch (error) {
      return failure("parser-crash", `The parser failed: ${describeError(error)}`, lines);
    }
  }

  async warmup(languages?: ParserLanguageId[]): Promise<void> {
    const modules = languages
      ? languages.map((id) => getLanguageModule(id)).filter((candidate) => candidate !== undefined)
      : LANGUAGE_MODULES;
    await Promise.all(
      modules.map(async (languageModule) => {
        try {
          const language = await this.runtime.loadLanguage(languageModule.grammarFile);
          for (const [name, source] of Object.entries(languageModule.queries ?? {})) {
            this.runtime.query(languageModule.grammarFile, language, name, source);
          }
        } catch {
          // Reported per file by parse() as "grammar-unavailable".
        }
      }),
    );
  }

  /** The synchronous part: parse, extract, free. Runs without yielding to other callers. */
  private parseLoaded(
    input: SourceParserInput,
    languageModule: LanguageModule,
    language: Language,
    content: string,
    lines: number,
    options: ParseOptions,
  ): ParseOutcome {
    const started = performance.now();
    const deadline = new Deadline(options.timeoutMs);
    const timedOut = () =>
      failure("timeout", `Parsing took longer than ${options.timeoutMs ?? 0} ms`, lines);
    const source = stripByteOrderMark(content);

    const tree = this.runtime.parse(languageModule.grammarFile, language, source, deadline);
    if (!tree) return timedOut();
    try {
      const context: ExtractionContext = {
        source,
        deadline,
        captures: (name, node) => {
          const querySource = languageModule.queries?.[name];
          if (querySource === undefined) throw new Error(`Unknown query "${name}"`);
          const query = this.runtime.query(languageModule.grammarFile, language, name, querySource);
          const captures = query.captures(
            node,
            deadline.bounded ? { progressCallback: () => deadline.expired() } : undefined,
          );
          deadline.check();
          return captures;
        },
      };
      const extraction = languageModule.extract(tree.rootNode, context);
      const outcome: ParseOutcome = {
        ok: true,
        language: input.language,
        symbols: extraction.symbols,
        imports: extraction.imports,
        exports: extraction.exports,
        lines,
        hasErrors: tree.rootNode.hasError,
        durationMs: roundDuration(performance.now() - started),
      };
      if (extraction.packageName) outcome.packageName = extraction.packageName;
      return outcome;
    } catch (error) {
      if (error instanceof ParseTimeoutError) return timedOut();
      throw error;
    } finally {
      tree.delete();
    }
  }
}

/**
 * Creates a parser that loads the tree-sitter runtime and grammars through
 * `loader` (from disk on the server, over HTTP in browsers/workers).
 */
export function createSourceParser(loader: GrammarLoader): SourceParser {
  return new TreeSitterSourceParser(loader);
}
