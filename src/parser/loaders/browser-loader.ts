import type { GrammarLoader } from "@/parser/types";
import { RUNTIME_WASM_FILE, assertWasmFileName } from "./grammar-files";

/**
 * Fetches tree-sitter WebAssembly binaries over HTTP (browsers and workers).
 * Grammars are served from `public/grammars`, i.e. `/grammars/<file>` by default.
 * Bytes are cached per file; failed requests are retried on the next call.
 */
export class BrowserGrammarLoader implements GrammarLoader {
  private readonly baseUrl: string;
  private readonly cache = new Map<string, Promise<Uint8Array>>();

  constructor(baseUrl = "/grammars") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
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
    const pending = this.fetchBytes(fileName);
    this.cache.set(fileName, pending);
    pending.catch(() => {
      if (this.cache.get(fileName) === pending) this.cache.delete(fileName);
    });
    return pending;
  }

  private async fetchBytes(fileName: string): Promise<Uint8Array> {
    assertWasmFileName(fileName);
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(fileName)}`);
    if (!response.ok) {
      throw new Error(`Could not download "${fileName}" (HTTP ${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
