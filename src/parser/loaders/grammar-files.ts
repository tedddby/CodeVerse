/** File name of the tree-sitter runtime binary. */
export const RUNTIME_WASM_FILE = "web-tree-sitter.wasm";

/** Only plain `*.wasm` file names are ever requested; anything else is rejected. */
const WASM_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.wasm$/;

/** Throws when `fileName` is not a bare WebAssembly file name (no paths, no traversal). */
export function assertWasmFileName(fileName: string): void {
  if (!WASM_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new Error(`Invalid grammar file name "${fileName}"`);
  }
}

/**
 * npm package that ships a binary: the runtime comes from `web-tree-sitter`,
 * the TSX grammar from `tree-sitter-typescript`, every other grammar from the
 * package of the same name (`tree-sitter-python.wasm` -> `tree-sitter-python`).
 */
export function packageForWasmFile(fileName: string): string {
  if (fileName === RUNTIME_WASM_FILE) return "web-tree-sitter";
  if (fileName === "tree-sitter-tsx.wasm") return "tree-sitter-typescript";
  return fileName.replace(/\.wasm$/, "");
}
