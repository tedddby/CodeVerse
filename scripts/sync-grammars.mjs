#!/usr/bin/env node
/**
 * Copies the tree-sitter runtime and grammar WebAssembly binaries from
 * node_modules into public/grammars so they can be loaded by the server-side
 * parser (and, in the future, by browser workers) without bundler magic.
 *
 * Usage:
 *   node scripts/sync-grammars.mjs              # always copy
 *   node scripts/sync-grammars.mjs --if-missing # copy only when files are absent
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const outDir = join(root, "public", "grammars");

/** [npm package, file inside package, output file name] */
const WASM_FILES = [
  ["web-tree-sitter", "web-tree-sitter.wasm", "web-tree-sitter.wasm"],
  ["tree-sitter-typescript", "tree-sitter-typescript.wasm", "tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript", "tree-sitter-tsx.wasm", "tree-sitter-tsx.wasm"],
  ["tree-sitter-javascript", "tree-sitter-javascript.wasm", "tree-sitter-javascript.wasm"],
  ["tree-sitter-python", "tree-sitter-python.wasm", "tree-sitter-python.wasm"],
  ["tree-sitter-java", "tree-sitter-java.wasm", "tree-sitter-java.wasm"],
  ["tree-sitter-go", "tree-sitter-go.wasm", "tree-sitter-go.wasm"],
  ["tree-sitter-rust", "tree-sitter-rust.wasm", "tree-sitter-rust.wasm"],
];

const ifMissing = process.argv.includes("--if-missing");

if (ifMissing && WASM_FILES.every(([, , out]) => existsSync(join(outDir, out)))) {
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

/** Resolves a file shipped inside an npm package, tolerating restrictive "exports" maps. */
function resolvePackageFile(pkg, file) {
  const candidates = [];
  try {
    candidates.push(require.resolve(`${pkg}/${file}`));
  } catch {
    // The package may not export this file explicitly.
  }
  try {
    candidates.push(join(dirname(require.resolve(`${pkg}/package.json`)), file));
  } catch {
    // The package may not export package.json.
  }
  candidates.push(join(root, "node_modules", pkg, file));
  return candidates.find((candidate) => existsSync(candidate));
}

let copied = 0;
for (const [pkg, file, out] of WASM_FILES) {
  const source = resolvePackageFile(pkg, file);
  if (!source) {
    console.warn(`[sync-grammars] ${pkg}/${file} not found; skipping ${out}`);
    continue;
  }
  copyFileSync(source, join(outDir, out));
  copied += 1;
}

console.log(
  `[sync-grammars] ${copied}/${WASM_FILES.length} WebAssembly binaries ready in public/grammars`,
);
