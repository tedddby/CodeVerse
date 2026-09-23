import { readFileSync } from "node:fs";
import path from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { PARSER_LANGUAGE_IDS, parserLanguageFor } from "@/lib/languages/registry";
import { SUPPORTED_LANGUAGES } from "./index";
import { LANGUAGE_MODULES, getLanguageModule } from "./registry";

const grammarsDirectory = path.join(process.cwd(), "public", "grammars");

async function loadLanguage(grammarFile: string): Promise<Language> {
  return Language.load(new Uint8Array(readFileSync(path.join(grammarsDirectory, grammarFile))));
}

beforeAll(async () => {
  await Parser.init({
    wasmBinary: new Uint8Array(readFileSync(path.join(grammarsDirectory, "web-tree-sitter.wasm"))),
  });
});

describe("language registry", () => {
  it("registers exactly the parser language ids of the shared language registry", () => {
    expect(LANGUAGE_MODULES.map((module) => module.id).sort()).toEqual(
      [...PARSER_LANGUAGE_IDS].sort(),
    );
  });

  it("routes every declared extension to the same language as the shared registry", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const extension of language.extensions) {
        expect(parserLanguageFor(`src/file.${extension}`), `.${extension}`).toBe(language.id);
      }
    }
  });

  it("resolves modules by id and rejects unknown or inherited keys", () => {
    expect(getLanguageModule("python")?.grammarFile).toBe("tree-sitter-python.wasm");
    expect(getLanguageModule("cobol")).toBeUndefined();
    expect(getLanguageModule("toString")).toBeUndefined();
    expect(getLanguageModule("__proto__")).toBeUndefined();
  });

  it("exposes SUPPORTED_LANGUAGES as copies of the module metadata", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(LANGUAGE_MODULES.length);
    const tsx = SUPPORTED_LANGUAGES.find((language) => language.id === "tsx");
    expect(tsx).toEqual({
      id: "tsx",
      displayName: "TSX",
      grammarFile: "tree-sitter-tsx.wasm",
      extensions: ["tsx"],
    });
  });

  describe.each(LANGUAGE_MODULES.map((module) => [module.id, module] as const))(
    "%s grammar",
    (_id, module) => {
      let language: Language;

      beforeAll(async () => {
        language = await loadLanguage(module.grammarFile);
      });

      it("knows every node type the module references", () => {
        const missing = module.vocabulary.nodeTypes.filter(
          (type) => language.idForNodeType(type, true) === null,
        );
        expect(missing).toEqual([]);
      });

      it("knows every field name the module references", () => {
        const missing = module.vocabulary.fields.filter(
          (field) => language.fieldIdForName(field) === null,
        );
        expect(missing).toEqual([]);
      });

      it("compiles every query", () => {
        for (const [name, source] of Object.entries(module.queries ?? {})) {
          let query: Query | null = null;
          expect(() => {
            query = new Query(language, source);
          }, name).not.toThrow();
          (query as Query | null)?.delete();
        }
      });
    },
  );
});
