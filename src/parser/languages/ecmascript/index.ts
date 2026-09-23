import type { Node } from "web-tree-sitter";
import { ExtractionBuilder } from "@/parser/extract/builder";
import type { Extraction, ExtractionContext, LanguageModule } from "@/parser/languages/types";
import type { ParserLanguageId } from "@/parser/types";
import { EcmascriptDeclarationWalker } from "./declarations";
import { CALL_IMPORTS_QUERY, CALL_IMPORTS_QUERY_SOURCE, collectCallImports } from "./modules";
import { type EcmascriptDialect, dialectVocabulary } from "./vocabulary";

/** Extraction shared by the JavaScript, TypeScript and TSX grammars. */
function extractEcmascript(root: Node, context: ExtractionContext): Extraction {
  const builder = new ExtractionBuilder();
  new EcmascriptDeclarationWalker(builder, context).walk(root);
  collectCallImports(builder, context, root);
  return builder.build();
}

export function createEcmascriptModule(options: {
  id: ParserLanguageId;
  displayName: string;
  grammarFile: string;
  extensions: readonly string[];
  dialect: EcmascriptDialect;
}): LanguageModule {
  return {
    id: options.id,
    displayName: options.displayName,
    grammarFile: options.grammarFile,
    extensions: options.extensions,
    vocabulary: dialectVocabulary(options.dialect),
    queries: { [CALL_IMPORTS_QUERY]: CALL_IMPORTS_QUERY_SOURCE },
    extract: extractEcmascript,
  };
}
