import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageForWasmFile } from "./grammar-files";
import { NodeGrammarLoader } from "./node-loader";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

let sandbox: string;

function writeBytes(directory: string, fileName: string, bytes: number[]): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, fileName), Uint8Array.from(bytes));
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "codeverse-grammars-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("NodeGrammarLoader", () => {
  it("loads the real runtime and grammars from public/grammars by default", async () => {
    const loader = new NodeGrammarLoader();
    const runtime = await loader.loadRuntime();
    const python = await loader.loadGrammar("tree-sitter-python.wasm");
    expect([...runtime.subarray(0, 4)]).toEqual(WASM_MAGIC);
    expect([...python.subarray(0, 4)]).toEqual(WASM_MAGIC);
    expect(python).toBeInstanceOf(Uint8Array);
  });

  it("prefers CODEVERSE_GRAMMAR_DIR over the project directories", async () => {
    const custom = path.join(sandbox, "custom");
    writeBytes(custom, "tree-sitter-python.wasm", [1, 2, 3]);
    vi.stubEnv("CODEVERSE_GRAMMAR_DIR", custom);
    const bytes = await new NodeGrammarLoader().loadGrammar("tree-sitter-python.wasm");
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("falls back to public/grammars, then to the npm package", async () => {
    vi.stubEnv("CODEVERSE_GRAMMAR_DIR", "");
    writeBytes(path.join(sandbox, "public", "grammars"), "tree-sitter-go.wasm", [7]);
    writeBytes(path.join(sandbox, "node_modules", "tree-sitter-go"), "tree-sitter-go.wasm", [8]);
    writeBytes(
      path.join(sandbox, "node_modules", "tree-sitter-typescript"),
      "tree-sitter-tsx.wasm",
      [9],
    );
    writeBytes(path.join(sandbox, "node_modules", "web-tree-sitter"), "web-tree-sitter.wasm", [10]);
    const loader = new NodeGrammarLoader({ cwd: sandbox });
    expect([...(await loader.loadGrammar("tree-sitter-go.wasm"))]).toEqual([7]);
    expect([...(await loader.loadGrammar("tree-sitter-tsx.wasm"))]).toEqual([9]);
    expect([...(await loader.loadRuntime())]).toEqual([10]);
  });

  it("searches only the configured directories, in order", async () => {
    const first = path.join(sandbox, "first");
    const second = path.join(sandbox, "second");
    writeBytes(second, "tree-sitter-rust.wasm", [2]);
    writeBytes(second, "tree-sitter-java.wasm", [2]);
    writeBytes(first, "tree-sitter-java.wasm", [1]);
    const loader = new NodeGrammarLoader({ directories: [first, second] });
    expect([...(await loader.loadGrammar("tree-sitter-rust.wasm"))]).toEqual([2]);
    expect([...(await loader.loadGrammar("tree-sitter-java.wasm"))]).toEqual([1]);
    await expect(loader.loadRuntime()).rejects.toThrow(/web-tree-sitter\.wasm/);
  });

  it("explains how to fix missing grammars without leaking absolute paths", async () => {
    const loader = new NodeGrammarLoader({ directories: [sandbox] });
    const failure = loader.loadGrammar("tree-sitter-python.wasm");
    await expect(failure).rejects.toThrow(/pnpm grammars/);
    await expect(failure).rejects.not.toThrow(sandbox);
  });

  it("caches bytes and retries after a failure", async () => {
    const loader = new NodeGrammarLoader({ directories: [sandbox] });
    await expect(loader.loadGrammar("tree-sitter-go.wasm")).rejects.toThrow();
    writeBytes(sandbox, "tree-sitter-go.wasm", [42]);
    const first = await loader.loadGrammar("tree-sitter-go.wasm");
    writeBytes(sandbox, "tree-sitter-go.wasm", [43]);
    const second = await loader.loadGrammar("tree-sitter-go.wasm");
    expect([...first]).toEqual([42]);
    expect(second).toBe(first);
  });

  it.each(["../secret.wasm", "nested/tree-sitter-go.wasm", "tree-sitter-go.so", "", ".wasm"])(
    "rejects the unsafe file name %j",
    async (fileName) => {
      const loader = new NodeGrammarLoader({ directories: [sandbox] });
      await expect(loader.loadGrammar(fileName)).rejects.toThrow(/Invalid grammar file name/);
    },
  );
});

describe("packageForWasmFile", () => {
  it.each([
    ["web-tree-sitter.wasm", "web-tree-sitter"],
    ["tree-sitter-tsx.wasm", "tree-sitter-typescript"],
    ["tree-sitter-typescript.wasm", "tree-sitter-typescript"],
    ["tree-sitter-python.wasm", "tree-sitter-python"],
  ])("maps %s to %s", (fileName, packageName) => {
    expect(packageForWasmFile(fileName)).toBe(packageName);
  });
});
