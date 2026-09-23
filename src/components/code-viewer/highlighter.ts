import type { GrammarState, HighlighterCore } from "shiki/core";
import { CODEVERSE_THEME, CODEVERSE_THEME_NAME } from "./codeverse-theme";
import type { ShikiLanguageId } from "./language-map";
import { SHIKI_LANGUAGE_LOADERS } from "./shiki-languages";

/**
 * Syntax highlighting abstraction used by the code viewer.
 *
 * The viewer depends only on these interfaces, so tests inject a synchronous
 * fake and production uses `loadShikiHighlighter`, which pulls Shiki (core +
 * JavaScript regex engine + one grammar per language) through dynamic imports
 * the first time the viewer opens. Nothing Shiki-related is in the initial bundle.
 */

export interface HighlightToken {
  content: string;
  /** Hex color; undefined means the default foreground. */
  color?: string;
  /** Bit flags: 1 italic, 2 bold, 4 underline, 8 strikethrough. */
  fontStyle?: number;
}

export type HighlightedLine = HighlightToken[];

/**
 * Tokenizes one document incrementally: consecutive calls continue from the
 * grammar state of the previous chunk, so a file can be highlighted in small
 * slices without blocking the main thread.
 */
export interface HighlightSession {
  tokenizeLines(lines: readonly string[]): HighlightedLine[];
}

export interface SourceHighlighter {
  /** Resolves to a session, or null when the grammar is unavailable (render plain text). */
  createSession(language: ShikiLanguageId): Promise<HighlightSession | null>;
}

export type HighlighterLoader = () => Promise<SourceHighlighter>;

/** Lines longer than this are not tokenized (minified code); they render plain. */
export const MAX_TOKENIZED_LINE_LENGTH = 2_000;
/** Per-line tokenization time limit in milliseconds. */
const TOKENIZE_TIME_LIMIT_MS = 50;

function createSession(highlighter: HighlighterCore, lang: string): HighlightSession {
  let grammarState: GrammarState | undefined;
  return {
    tokenizeLines(lines) {
      const tokens = highlighter.codeToTokensBase(lines.join("\n"), {
        lang,
        theme: CODEVERSE_THEME_NAME,
        grammarState,
        tokenizeMaxLineLength: MAX_TOKENIZED_LINE_LENGTH,
        tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS,
      });
      grammarState = highlighter.getLastGrammarState(tokens) ?? grammarState;
      return tokens.map((line) =>
        line.map((token) => ({
          content: token.content,
          ...(token.color ? { color: token.color } : {}),
          ...(token.fontStyle ? { fontStyle: token.fontStyle } : {}),
        })),
      );
    },
  };
}

async function createShikiSourceHighlighter(): Promise<SourceHighlighter> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]);
  const highlighter = await createHighlighterCore({
    themes: [CODEVERSE_THEME],
    langs: [],
    // Skips the few Oniguruma-only patterns instead of failing the whole grammar.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    warnings: false,
  });

  // Grammar name to tokenize with, per language (null when loading failed).
  const loaded = new Map<ShikiLanguageId, Promise<string | null>>();
  const ensureLanguage = (language: ShikiLanguageId): Promise<string | null> => {
    const existing = loaded.get(language);
    if (existing) return existing;
    const pending = SHIKI_LANGUAGE_LOADERS[language]()
      .then(async (module) => {
        const registrations = module.default;
        await highlighter.loadLanguage(...registrations);
        // Grammar modules list embedded dependencies first and their own grammar last.
        return registrations[registrations.length - 1]?.name ?? language;
      })
      .catch((error: unknown) => {
        console.warn(
          `[codeverse] Could not load the ${language} grammar; showing plain text.`,
          error,
        );
        return null;
      });
    loaded.set(language, pending);
    return pending;
  };

  return {
    async createSession(language) {
      const lang = await ensureLanguage(language);
      return lang ? createSession(highlighter, lang) : null;
    },
  };
}

let shikiHighlighter: Promise<SourceHighlighter> | null = null;

/** Lazily creates the process-wide Shiki highlighter (retried if creation failed). */
export const loadShikiHighlighter: HighlighterLoader = () => {
  shikiHighlighter ??= createShikiSourceHighlighter().catch((error: unknown) => {
    shikiHighlighter = null;
    throw error;
  });
  return shikiHighlighter;
};
