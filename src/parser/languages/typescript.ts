import { createEcmascriptModule } from "./ecmascript";

/** TypeScript (`.ts`, `.mts`, `.cts`), parsed with tree-sitter-typescript's `typescript` dialect. */
export const typescriptModule = createEcmascriptModule({
  id: "typescript",
  displayName: "TypeScript",
  grammarFile: "tree-sitter-typescript.wasm",
  extensions: ["ts", "mts", "cts"],
  dialect: "typescript",
});
