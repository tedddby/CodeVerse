import { goModule } from "./languages/go";
import { javaModule } from "./languages/java";
import { javascriptModule } from "./languages/javascript";
import { pythonModule } from "./languages/python";
import { rustModule } from "./languages/rust";
import { tsxModule } from "./languages/tsx";
import type { LanguageModule } from "./languages/types";
import { typescriptModule } from "./languages/typescript";
import type { ParserLanguageId } from "./types";

/**
 * Every tree-sitter language CodeVerse extracts. Adding a language means
 * writing one `LanguageModule` and adding it here (plus its `ParserLanguageId`
 * and grammar file in `src/lib/languages/registry.ts` / `scripts/sync-grammars.mjs`).
 */
const MODULES: Readonly<Record<ParserLanguageId, LanguageModule>> = {
  typescript: typescriptModule,
  tsx: tsxModule,
  javascript: javascriptModule,
  python: pythonModule,
  java: javaModule,
  go: goModule,
  rust: rustModule,
};

export const LANGUAGE_MODULES: readonly LanguageModule[] = Object.values(MODULES);

/** The module for a language id, or undefined for ids that are not parseable. */
export function getLanguageModule(id: string): LanguageModule | undefined {
  return Object.hasOwn(MODULES, id) ? MODULES[id as ParserLanguageId] : undefined;
}
