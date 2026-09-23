import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GrammarLoader } from "@/parser/types";
import { RUNTIME_WASM_FILE, assertWasmFileName, packageForWasmFile } from "./grammar-files";

interface Candidate {
  /** Absolute file path. */
  file: string;
  /** Path-free description used in error messages (messages may reach clients). */
  label: string;
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

/**
 * Reads tree-sitter WebAssembly binaries from disk (server only).
 *
 * Default search order for a file:
 * 1. `$CODEVERSE_GRAMMAR_DIR/<file>`
 * 2. `<cwd>/public/grammars/<file>` (populated by `pnpm grammars`)
 * 3. `<cwd>/node_modules/<package>/<file>` (the npm package shipping it)
 *
 * Passing `directories` replaces that list: only those directories are searched.
 * `cwd` changes the base of the default search (defaults to `process.cwd()`).
 * Bytes are cached per file; failed reads are retried on the next request.
 */
export class NodeGrammarLoader implements GrammarLoader {
  private readonly directories: readonly string[] | null;
  private readonly cwd: string | null;
  private readonly cache = new Map<string, Promise<Uint8Array>>();

  constructor(options: { directories?: string[]; cwd?: string } = {}) {
    this.directories = options.directories ? [...options.directories] : null;
    this.cwd = options.cwd ?? null;
  }

  loadRuntime(): Promise<Uint8Array> {
    return this.load(RUNTIME_WASM_FILE);
  }

  loadGrammar(fileName: string): Promise<Uint8Array> {
    return this.load(fileName);
  }

  private load(fileName: string): Promise<Uint8Array> {
    const cached = this.cache.get(fileName);
    if (cached) return cached;
    const pending = this.read(fileName);
    this.cache.set(fileName, pending);
    pending.catch(() => {
      if (this.cache.get(fileName) === pending) this.cache.delete(fileName);
    });
    return pending;
  }

  private async read(fileName: string): Promise<Uint8Array> {
    assertWasmFileName(fileName);
    const candidates = this.candidates(fileName);
    for (const candidate of candidates) {
      try {
        // Copy into a standalone Uint8Array: Buffers may be views into a shared pool.
        return new Uint8Array(await readFile(candidate.file));
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
    const searched = candidates.map((candidate) => candidate.label).join(", ");
    throw new Error(
      `Tree-sitter binary "${fileName}" was not found (searched ${searched}). ` +
        `Run "pnpm grammars" to copy the grammars into public/grammars.`,
    );
  }

  private candidates(fileName: string): Candidate[] {
    if (this.directories) {
      return this.directories.map((directory, index) => ({
        file: path.resolve(directory, fileName),
        label: `configured directory #${index + 1}`,
      }));
    }
    const candidates: Candidate[] = [];
    const configured = process.env.CODEVERSE_GRAMMAR_DIR;
    if (configured) {
      candidates.push({ file: path.resolve(configured, fileName), label: "CODEVERSE_GRAMMAR_DIR" });
    }
    const root = this.cwd ?? process.cwd();
    candidates.push(
      { file: path.join(root, "public", "grammars", fileName), label: "public/grammars" },
      {
        file: path.join(root, "node_modules", packageForWasmFile(fileName), fileName),
        label: `node_modules/${packageForWasmFile(fileName)}`,
      },
    );
    return candidates;
  }
}
