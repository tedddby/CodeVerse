import { Language, Parser, Query, type Tree } from "web-tree-sitter";
import type { Deadline } from "./deadline";
import type { GrammarLoader } from "./types";

/**
 * The web-tree-sitter WebAssembly module is a process-wide (per JS realm)
 * singleton, so its initialization is shared by every runtime. Concurrent
 * `Parser.init` calls would instantiate the module twice, hence the single
 * in-flight promise. A failed initialization is forgotten so it can be retried.
 */
let runtimeInitialization: Promise<void> | null = null;

function initializeTreeSitter(loader: GrammarLoader): Promise<void> {
  if (runtimeInitialization) return runtimeInitialization;
  const pending = (async () => {
    // Always hand Emscripten the bytes: `locateFile` based loading is not bundler-safe.
    const wasmBinary = await loader.loadRuntime();
    await Parser.init({ wasmBinary });
  })();
  runtimeInitialization = pending;
  pending.catch(() => {
    if (runtimeInitialization === pending) runtimeInitialization = null;
  });
  return pending;
}

/**
 * Owns the tree-sitter objects used by one `SourceParser`:
 * - one `Language` per grammar file, loaded lazily through the `GrammarLoader`;
 * - one reusable `Parser` per grammar (parsing is synchronous, so a single
 *   instance is never used by two parses at once on JavaScript's single thread);
 * - compiled `Query` objects, keyed by grammar and query name.
 */
export class TreeSitterRuntime {
  private readonly loader: GrammarLoader;
  private readonly languages = new Map<string, Promise<Language>>();
  private readonly parsers = new Map<string, Parser>();
  private readonly queries = new Map<string, Query>();

  constructor(loader: GrammarLoader) {
    this.loader = loader;
  }

  /** Loads (once) the grammar stored in `grammarFile`. Failed loads are retried on the next call. */
  loadLanguage(grammarFile: string): Promise<Language> {
    const cached = this.languages.get(grammarFile);
    if (cached) return cached;
    const pending = (async () => {
      await initializeTreeSitter(this.loader);
      const bytes = await this.loader.loadGrammar(grammarFile);
      return Language.load(bytes);
    })();
    this.languages.set(grammarFile, pending);
    pending.catch(() => {
      if (this.languages.get(grammarFile) === pending) this.languages.delete(grammarFile);
    });
    return pending;
  }

  /**
   * Parses `source`, returning `null` when the deadline expired mid-parse.
   * A parser that throws is discarded and recreated on the next call.
   */
  parse(grammarFile: string, language: Language, source: string, deadline: Deadline): Tree | null {
    const parser = this.parserFor(grammarFile, language);
    try {
      const tree = parser.parse(
        source,
        null,
        deadline.bounded ? { progressCallback: () => deadline.expired() } : undefined,
      );
      // A cancelled parse would otherwise resume on the next call with other input.
      if (!tree) parser.reset();
      return tree;
    } catch (error) {
      this.discardParser(grammarFile);
      throw error;
    }
  }

  /** Returns the compiled query `name` for a grammar, compiling it on first use. */
  query(grammarFile: string, language: Language, name: string, source: string): Query {
    const key = `${grammarFile}\u0000${name}\u0000${source}`;
    let query = this.queries.get(key);
    if (!query) {
      query = new Query(language, source);
      this.queries.set(key, query);
    }
    return query;
  }

  private parserFor(grammarFile: string, language: Language): Parser {
    let parser = this.parsers.get(grammarFile);
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(language);
      this.parsers.set(grammarFile, parser);
    }
    return parser;
  }

  private discardParser(grammarFile: string): void {
    const parser = this.parsers.get(grammarFile);
    this.parsers.delete(grammarFile);
    try {
      parser?.delete();
    } catch {
      // The instance may already be unusable; dropping the reference is enough.
    }
  }
}
