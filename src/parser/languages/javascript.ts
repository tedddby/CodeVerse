import { createEcmascriptModule } from "./ecmascript";

/** JavaScript including JSX, ES modules and CommonJS (`.js`, `.jsx`, `.mjs`, `.cjs`). */
export const javascriptModule = createEcmascriptModule({
  id: "javascript",
  displayName: "JavaScript",
  grammarFile: "tree-sitter-javascript.wasm",
  extensions: ["js", "jsx", "mjs", "cjs"],
  dialect: "javascript",
});
