/**
 * Shared helpers for parser tests. Tests run against the real WebAssembly
 * grammars in public/grammars (via NodeGrammarLoader), never against mocks.
 */
import { createSourceParser, type SourceParser } from "./index";
import { NodeGrammarLoader } from "./loaders/node-loader";
import type { ParseOptions, ParseResult, ParsedSymbol, ParserLanguageId } from "./types";

let sharedParser: SourceParser | null = null;

/** One parser per test file (grammars load once). */
export function testParser(): SourceParser {
  sharedParser ??= createSourceParser(new NodeGrammarLoader());
  return sharedParser;
}

/** Parses `content` and fails the test when the outcome is not successful. */
export async function parseOk(
  language: ParserLanguageId,
  content: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const outcome = await testParser().parse(
    { path: `fixture.${language}`, content, language },
    options,
  );
  if (!outcome.ok) {
    throw new Error(`Expected a successful parse, got "${outcome.reason}": ${outcome.message}`);
  }
  return outcome;
}

export interface SymbolRow {
  name: string;
  kind: ParsedSymbol["kind"];
  lines: [number, number];
  exported: boolean;
  parent?: string;
}

/** Compact, readable projection of symbols for exact assertions (parent by name). */
export function symbolRows(result: ParseResult): SymbolRow[] {
  return result.symbols.map((symbol) => {
    const row: SymbolRow = {
      name: symbol.name,
      kind: symbol.kind,
      lines: [symbol.startLine, symbol.endLine],
      exported: symbol.exported,
    };
    if (symbol.parentIndex !== undefined) {
      const parent = result.symbols[symbol.parentIndex];
      row.parent = parent ? parent.name : `#${symbol.parentIndex}`;
    }
    return row;
  });
}

/** Signature of the first symbol named `name`. */
export function signatureOf(result: ParseResult, name: string): string | undefined {
  return result.symbols.find((symbol) => symbol.name === name)?.signature;
}

/** Joins lines with "\n" (keeps multi-line fixtures readable and line numbers obvious). */
export function source(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}
