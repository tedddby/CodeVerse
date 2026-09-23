/**
 * Server-only entry point: a process-wide parser that reads grammars from disk.
 * Do not import from client components (it depends on `node:fs`).
 */
import { type SourceParser, createSourceParser } from "./index";
import { NodeGrammarLoader } from "./loaders/node-loader";

export { NodeGrammarLoader } from "./loaders/node-loader";

/**
 * Kept on `globalThis` so development hot reloads (which re-evaluate this
 * module) keep reusing the already-initialized parser and loaded grammars.
 */
const SERVER_PARSER_KEY = Symbol.for("codeverse.parser.server");

type ParserHolder = { [SERVER_PARSER_KEY]?: SourceParser };

/** The process singleton parser backed by {@link NodeGrammarLoader}. */
export function getServerParser(): SourceParser {
  const holder = globalThis as ParserHolder;
  let parser = holder[SERVER_PARSER_KEY];
  if (!parser) {
    parser = createSourceParser(new NodeGrammarLoader());
    holder[SERVER_PARSER_KEY] = parser;
  }
  return parser;
}
