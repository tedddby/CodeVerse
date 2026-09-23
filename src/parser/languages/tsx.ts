import { createEcmascriptModule } from "./ecmascript";

/**
 * TypeScript with JSX (`.tsx`). A separate grammar because `<T>expr` casts and
 * JSX elements are ambiguous; files are still reported as TypeScript.
 */
export const tsxModule = createEcmascriptModule({
  id: "tsx",
  displayName: "TSX",
  grammarFile: "tree-sitter-tsx.wasm",
  extensions: ["tsx"],
  dialect: "typescript",
});
