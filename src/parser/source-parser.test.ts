import { mulberry32 } from "@/fixtures/fixture-builder";
import { SUPPORTED_LANGUAGES, countLines, createSourceParser, type SourceParser } from "./index";
import { NodeGrammarLoader } from "./loaders/node-loader";
import { parseOk, source, symbolRows, testParser } from "./test-helpers";
import type { GrammarLoader, ParserLanguageId } from "./types";

/** A generated TypeScript module with `functions` exported functions (4 lines each). */
function generatedModule(functions: number): string {
  const lines: string[] = ['import { helper } from "./helper";', ""];
  for (let index = 0; index < functions; index += 1) {
    lines.push(
      `export function fn${index}(value: number): number {`,
      `  const doubled = helper(value) * ${index};`,
      "  return doubled > 10 ? doubled : value;",
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("SourceParser", () => {
  beforeAll(async () => {
    await testParser().warmup();
  });

  describe("edge-case inputs", () => {
    it("parses an empty file", async () => {
      const result = await parseOk("python", "");
      expect(result).toMatchObject({
        symbols: [],
        imports: [],
        exports: [],
        lines: 0,
        hasErrors: false,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("ignores a byte order mark and CRLF line endings", async () => {
      const content =
        "\uFEFFimport os\r\n\r\nclass Service:\r\n    def run(self):\r\n        pass\r\n";
      const result = await parseOk("python", content);
      expect(result.hasErrors).toBe(false);
      expect(result.lines).toBe(5);
      expect(result.imports).toEqual([{ specifier: "os", kind: "import", line: 1 }]);
      expect(symbolRows(result)).toEqual([
        { name: "Service", kind: "class", lines: [3, 5], exported: true },
        { name: "run", kind: "method", lines: [4, 5], exported: true, parent: "Service" },
      ]);
      expect(result.symbols[0]?.signature).toBe("class Service");
    });

    it("keeps Unicode identifiers and positions intact", async () => {
      const result = await parseOk(
        "typescript",
        source(
          'const greeting = "héllo 😀 世界";',
          "export function café(ñ: number): number { return ñ; }",
          "export class Δelta {}",
        ),
      );
      expect(symbolRows(result)).toEqual([
        { name: "café", kind: "function", lines: [2, 2], exported: true },
        { name: "Δelta", kind: "class", lines: [3, 3], exported: true },
      ]);
      expect(result.symbols[0]?.signature).toBe("function café(ñ: number): number");
    });

    it("reports syntax errors but still extracts what it can", async () => {
      const result = await parseOk(
        "typescript",
        source(
          'import { a } from "./a";', // 1
          "export function first(x: number) {", // 2
          "  return x +;", // 3
          "}", // 4
          "export const broken = ;", // 5
          "export class Service {", // 6
          "  run() {", // 7
          "    if (x) {", // 8
          "  }", // 9
          "}", // 10
          "export function last() {}", // 11
        ),
      );
      expect(result.hasErrors).toBe(true);
      expect(result.imports).toEqual([{ specifier: "./a", kind: "import", line: 1, names: ["a"] }]);
      const names = result.symbols.map((symbol) => symbol.name);
      expect(names).toEqual(expect.arrayContaining(["first", "Service", "run", "last"]));
    });

    it("recovers declarations swallowed by a top-level syntax error", async () => {
      const result = await parseOk(
        "typescript",
        source(
          "export class Broken {",
          "  bad( {",
          "}",
          "export function after(x: number) {",
          "  return x;",
          "}",
        ),
      );
      expect(result.hasErrors).toBe(true);
      expect(result.symbols.map((symbol) => symbol.name)).toContain("after");
    });

    it("handles very long lines", async () => {
      const longString = "x".repeat(200_000);
      const result = await parseOk(
        "javascript",
        `export const LONG = "${longString}"; export function after() {}\n`,
      );
      expect(result.lines).toBe(1);
      expect(result.symbols.map((symbol) => symbol.name)).toEqual(["LONG", "after"]);
      expect(result.symbols[0]?.signature).toBe("const LONG");
    });

    it("handles deeply nested code without overflowing the stack", async () => {
      const depth = 5_000;
      const nestedArray = `export const nested = ${"[".repeat(depth)}${"]".repeat(depth)};\n`;
      const nestedResult = await parseOk("javascript", nestedArray);
      expect(nestedResult.symbols.map((symbol) => symbol.name)).toEqual(["nested"]);

      const namespaces = 300;
      const nestedNamespaces =
        Array.from({ length: namespaces }, (_, index) => `namespace N${index} {`).join("\n") +
        "\nexport function leaf() {}\n" +
        "}\n".repeat(namespaces);
      const namespaceResult = await parseOk("typescript", nestedNamespaces);
      expect(namespaceResult.hasErrors).toBe(false);
      expect(namespaceResult.symbols).toHaveLength(namespaces + 1);
      const leaf = namespaceResult.symbols[namespaces];
      expect(leaf?.name).toBe("leaf");
      expect(leaf?.parentIndex).toBe(namespaces - 1);
    });

    it("parses minified bundles within a bounded time", async () => {
      let bundle = "";
      for (let index = 0; index < 20_000; index += 1) {
        bundle += `function a${index}(b){return b+${index}}var c${index}=a${index}(1);`;
      }
      const started = performance.now();
      const outcome = await testParser().parse(
        { path: "dist/app.min.js", content: bundle, language: "javascript" },
        { timeoutMs: 2_000 },
      );
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(5_000);
      if (outcome.ok) {
        expect(outcome.lines).toBe(1);
        // Functions only: the non-exported `var` initializers are noise.
        expect(outcome.symbols.length).toBe(20_000);
      } else {
        expect(outcome.reason).toBe("timeout");
      }
    });

    it("survives hostile input in every grammar", async () => {
      const random = mulberry32(7);
      const noise = Array.from({ length: 4_000 }, () =>
        String.fromCharCode(Math.floor(random() * 0x3000)),
      ).join("");
      const hostileInputs = [
        noise,
        "\u0000\u0001\u0002 }}}{{{ ((( @@@ \n\u0003",
        "class { def fn impl mod package import from use (",
        "\uD83D unpaired surrogate \uDE00",
        `${"(".repeat(3_000)}${"{".repeat(3_000)}`,
      ];
      for (const language of SUPPORTED_LANGUAGES) {
        for (const content of hostileInputs) {
          const outcome = await testParser().parse({
            path: "hostile",
            content,
            language: language.id,
          });
          if (!outcome.ok) throw new Error(`${language.id}: ${outcome.reason} ${outcome.message}`);
          expect(outcome.lines).toBe(countLines(content));
          for (const symbol of outcome.symbols) {
            expect(symbol.name.length).toBeGreaterThan(0);
            expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
            if (symbol.parentIndex !== undefined) {
              expect(outcome.symbols[symbol.parentIndex]).toBeDefined();
            }
          }
        }
      }
    });
  });

  describe("failures", () => {
    it("refuses content larger than maxBytes (UTF-8) without parsing", async () => {
      const content = "é".repeat(600); // 1,200 bytes
      const outcome = await testParser().parse(
        { path: "big.py", content: `${content}\n${content}`, language: "python" },
        { maxBytes: 1_000 },
      );
      expect(outcome).toMatchObject({ ok: false, reason: "too-large", lines: 2 });
      const fits = await testParser().parse(
        { path: "small.py", content: "x = 1\n", language: "python" },
        { maxBytes: 6 },
      );
      expect(fits.ok).toBe(true);
    });

    it("times out gracefully on a big file and keeps working afterwards", async () => {
      const content = generatedModule(25_000); // ~100k lines
      const outcome = await testParser().parse(
        { path: "generated.ts", content, language: "typescript" },
        { timeoutMs: 1 },
      );
      expect(outcome).toMatchObject({ ok: false, reason: "timeout", lines: 100_002 });
      if (!outcome.ok) expect(outcome.message).toMatch(/1 ms/);

      const next = await parseOk("typescript", "export const after = () => 1;\n");
      expect(next.symbols.map((symbol) => symbol.name)).toEqual(["after"]);
    });

    it("reports grammar-unavailable when the grammar cannot be loaded", async () => {
      const working = new NodeGrammarLoader();
      const brokenLoader: GrammarLoader = {
        loadRuntime: () => working.loadRuntime(),
        loadGrammar: (fileName) => Promise.reject(new Error(`${fileName} is missing`)),
      };
      const parser = createSourceParser(brokenLoader);
      const outcome = await parser.parse({ path: "a.go", content: "package a\n", language: "go" });
      expect(outcome).toEqual({
        ok: false,
        reason: "grammar-unavailable",
        message: "The Go grammar could not be loaded: tree-sitter-go.wasm is missing",
        lines: 1,
      });
      await expect(parser.warmup(["go"])).resolves.toBeUndefined();
    });

    it("retries a grammar after a transient loading failure", async () => {
      const working = new NodeGrammarLoader();
      let failures = 1;
      const flakyLoader: GrammarLoader = {
        loadRuntime: () => working.loadRuntime(),
        loadGrammar: (fileName) =>
          failures-- > 0
            ? Promise.reject(new Error("network down"))
            : working.loadGrammar(fileName),
      };
      const parser = createSourceParser(flakyLoader);
      const input = { path: "a.rs", content: "fn main() {}\n", language: "rust" as const };
      expect((await parser.parse(input)).ok).toBe(false);
      expect((await parser.parse(input)).ok).toBe(true);
    });

    it("reports unknown languages as grammar-unavailable", async () => {
      const outcome = await testParser().parse({
        path: "a.cob",
        content: "IDENTIFICATION DIVISION.",
        language: "cobol" as ParserLanguageId,
      });
      expect(outcome).toMatchObject({ ok: false, reason: "grammar-unavailable", lines: 1 });
    });

    it("never throws, even for malformed input", async () => {
      const outcome = await testParser().parse({
        path: "a.py",
        content: undefined as unknown as string,
        language: "python",
      });
      expect(outcome).toMatchObject({ ok: false, reason: "parser-crash", lines: 0 });
    });
  });

  describe("throughput", () => {
    it("parses 200 files concurrently with independent results", async () => {
      const languages: ParserLanguageId[] = ["typescript", "python", "go", "rust"];
      const inputs = Array.from({ length: 200 }, (_, index) => {
        const language = languages[index % languages.length] ?? "typescript";
        const content =
          language === "typescript"
            ? `import { x } from "./dep${index}";\nexport function fn${index}() {}\n`
            : language === "python"
              ? `import dep${index}\ndef fn${index}():\n    pass\n`
              : language === "go"
                ? `package p${index}\nimport "dep${index}"\nfunc Fn${index}() {}\n`
                : `use dep${index}::X;\npub fn fn${index}() {}\n`;
        return { path: `file${index}`, content, language };
      });
      const parser: SourceParser = testParser();
      const outcomes = await Promise.all(inputs.map((input) => parser.parse(input)));
      outcomes.forEach((outcome, index) => {
        if (!outcome.ok) throw new Error(`file${index} failed: ${outcome.message}`);
        expect(outcome.language).toBe(inputs[index]?.language);
        expect(outcome.symbols).toHaveLength(1);
        expect(outcome.symbols[0]?.name.toLowerCase()).toBe(`fn${index}`);
        expect(outcome.imports).toHaveLength(1);
        expect(outcome.imports[0]?.specifier).toContain(`dep${index}`);
      });
    });

    it("parses a generated 5,000-line TypeScript file in under a second", async () => {
      const content = generatedModule(1_250);
      await parseOk("typescript", generatedModule(10)); // JIT warm-up
      const started = performance.now();
      const result = await parseOk("typescript", content, { timeoutMs: 10_000 });
      const elapsed = performance.now() - started;
      expect(result.lines).toBe(5_002);
      expect(result.symbols).toHaveLength(1_250);
      expect(result.symbols[1_249]).toMatchObject({
        name: "fn1249",
        startLine: 4_999,
        endLine: 5_002,
        exported: true,
      });
      expect(elapsed).toBeLessThan(1_000);
    });
  });
});
