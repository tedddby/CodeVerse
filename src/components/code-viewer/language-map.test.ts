import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@/lib/languages/registry";
import { CODEVERSE_THEME, CODEVERSE_THEME_NAME } from "./codeverse-theme";
import { SHIKI_LANGUAGE_IDS, shikiLanguageFor } from "./language-map";
import { SHIKI_LANGUAGE_LOADERS } from "./shiki-languages";

describe("shikiLanguageFor", () => {
  it("maps TypeScript and JavaScript dialects by extension", () => {
    expect(shikiLanguageFor("typescript", "src/a.ts")).toBe("typescript");
    expect(shikiLanguageFor("typescript", "src/App.tsx")).toBe("tsx");
    expect(shikiLanguageFor("typescript", "src/a.mts")).toBe("typescript");
    expect(shikiLanguageFor("javascript", "a.js")).toBe("javascript");
    expect(shikiLanguageFor("javascript", "Button.jsx")).toBe("jsx");
    expect(shikiLanguageFor("javascript", "a.cjs")).toBe("javascript");
  });

  it("maps languages whose registry id matches Shiki", () => {
    for (const id of [
      "python",
      "java",
      "go",
      "rust",
      "c",
      "cpp",
      "csharp",
      "ruby",
      "php",
      "swift",
      "kotlin",
      "sql",
      "yaml",
      "toml",
      "html",
      "css",
      "xml",
      "markdown",
      "dockerfile",
    ]) {
      expect(shikiLanguageFor(id, `file.${id}`)).toBe(id);
    }
  });

  it("renames registry ids that differ from Shiki's", () => {
    expect(shikiLanguageFor("shell", "scripts/deploy.sh")).toBe("shellscript");
    expect(shikiLanguageFor("batch", "build.bat")).toBe("bat");
    expect(shikiLanguageFor("protobuf", "api.proto")).toBe("proto");
    expect(shikiLanguageFor("makefile", "Makefile")).toBe("make");
    expect(shikiLanguageFor("svg", "logo.svg")).toBe("xml");
    expect(shikiLanguageFor("assembly", "boot.s")).toBe("asm");
    expect(shikiLanguageFor("wasm-text", "mod.wat")).toBe("wasm");
  });

  it("distinguishes JSON flavours", () => {
    expect(shikiLanguageFor("json", "package.json")).toBe("json");
    expect(shikiLanguageFor("json", "tsconfig.json")).toBe("jsonc");
    expect(shikiLanguageFor("json", "packages/app/tsconfig.build.json")).toBe("jsonc");
    expect(shikiLanguageFor("json", ".vscode/settings.json")).toBe("jsonc");
    expect(shikiLanguageFor("json", "config.jsonc")).toBe("jsonc");
    expect(shikiLanguageFor("json", "data.json5")).toBe("json5");
  });

  it("handles style, docs and config variants", () => {
    expect(shikiLanguageFor("scss", "a.scss")).toBe("scss");
    expect(shikiLanguageFor("scss", "a.sass")).toBe("sass");
    expect(shikiLanguageFor("markdown", "README.md")).toBe("markdown");
    expect(shikiLanguageFor("markdown", "docs/page.mdx")).toBe("mdx");
    expect(shikiLanguageFor("ini", ".env")).toBe("dotenv");
    expect(shikiLanguageFor("ini", "app.properties")).toBe("properties");
    expect(shikiLanguageFor("ini", "setup.cfg")).toBe("ini");
    expect(shikiLanguageFor("terraform", "main.tf")).toBe("terraform");
    expect(shikiLanguageFor("terraform", "config.hcl")).toBe("hcl");
  });

  it("falls back to plain text for unknown and prose languages", () => {
    expect(shikiLanguageFor("unknown", "LICENSE")).toBeNull();
    expect(shikiLanguageFor("text", "notes.txt")).toBeNull();
    expect(shikiLanguageFor("csv", "data.csv")).toBeNull();
    expect(shikiLanguageFor("unknown", "config/.env.local")).toBe("dotenv");
  });

  it("returns a loadable grammar for every registry language it maps", () => {
    for (const language of LANGUAGES) {
      for (const extension of language.extensions) {
        const mapped = shikiLanguageFor(language.id, `file.${extension}`);
        if (mapped) expect(SHIKI_LANGUAGE_IDS).toContain(mapped);
      }
    }
    expect(Object.keys(SHIKI_LANGUAGE_LOADERS).sort()).toEqual([...SHIKI_LANGUAGE_IDS].sort());
  });
});

describe("Shiki integration", () => {
  it("tokenizes TypeScript with the CodeVerse theme and JavaScript regex engine", async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, typescript] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        SHIKI_LANGUAGE_LOADERS.typescript(),
      ]);
    const highlighter = await createHighlighterCore({
      themes: [CODEVERSE_THEME],
      langs: [typescript.default],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    const tokens = highlighter.codeToTokensBase("const answer: number = 42; // done", {
      lang: "typescript",
      theme: CODEVERSE_THEME_NAME,
      // No per-line time limit: on a loaded machine the first line also pays for
      // compiling the grammar, and a hit limit leaves the rest of the line unstyled.
      tokenizeTimeLimit: 0,
    });
    const flat = tokens[0] ?? [];
    expect(flat.map((token) => token.content).join("")).toBe("const answer: number = 42; // done");
    const colorOf = (text: string) =>
      flat.find((token) => token.content.includes(text))?.color?.toLowerCase();
    expect(colorOf("const")).toBe("#b3a6ff");
    expect(colorOf("42")).toBe("#f5a3c3");
    expect(colorOf("done")).toBe("#5f6d85");
    highlighter.dispose();
    // Cold imports compile the TypeScript grammar; slow under a fully parallel suite.
  }, 60_000);

  it("continues grammar state across chunks (multi-line comments)", async () => {
    const { loadShikiHighlighter } = await import("./highlighter");
    const highlighter = await loadShikiHighlighter();
    const session = await highlighter.createSession("typescript");
    expect(session).not.toBeNull();
    const first = session?.tokenizeLines(["/* start of a", "still comment"]) ?? [];
    const second = session?.tokenizeLines(["end */ const x = 1;"]) ?? [];
    expect(first).toHaveLength(2);
    // The chunk boundary does not reset the comment: "end */" is still coloured as a comment.
    expect(second[0]?.[0]?.content.startsWith("end")).toBe(true);
    expect(second[0]?.[0]?.color?.toLowerCase()).toBe("#5f6d85");
  });
});
