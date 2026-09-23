import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/fixtures/fixture-builder";
import { resolveDependencies } from "./index";
import type { DependencyInputFile, DependencyResolutionInput } from "./types";

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = current;
  }
  return copy;
}

const files: DependencyInputFile[] = [
  {
    path: "web/src/index.ts",
    language: "typescript",
    parserLanguage: "typescript",
    imports: [
      { specifier: "./util", kind: "import", line: 1 },
      { specifier: "./util", kind: "import", line: 2 },
      { specifier: "react", kind: "import", line: 3 },
    ],
  },
  {
    path: "web/src/util.ts",
    language: "typescript",
    parserLanguage: "typescript",
    imports: [{ specifier: "./index", kind: "import", line: 1 }],
  },
  {
    path: "web/src/app.jsx",
    language: "javascript",
    parserLanguage: "javascript",
    imports: [{ specifier: "react", kind: "import", line: 1 }],
  },
  {
    path: "api/main.py",
    language: "python",
    parserLanguage: "python",
    imports: [
      { specifier: "api.db", kind: "import", line: 1 },
      { specifier: "flask", kind: "import", line: 2 },
    ],
  },
  { path: "api/db.py", language: "python", parserLanguage: "python", imports: [] },
  { path: "api/__init__.py", language: "python", parserLanguage: "python", imports: [] },
  {
    path: "svc/main.go",
    language: "go",
    parserLanguage: "go",
    imports: [
      { specifier: "example.com/svc/store", kind: "import", line: 3 },
      { specifier: "fmt", kind: "import", line: 4 },
    ],
  },
  { path: "svc/store/store.go", language: "go", parserLanguage: "go", imports: [] },
];

const input: DependencyResolutionInput = {
  files,
  graphPaths: new Set([...files.map((file) => file.path)]),
  allPaths: new Set([...files.map((file) => file.path), "svc/go.mod", "README.md"]),
  configFiles: new Map([["svc/go.mod", "module example.com/svc\n"]]),
};

function serialize(result: ReturnType<typeof resolveDependencies>): string {
  return JSON.stringify({
    imports: [...result.importsByPath.entries()],
    edges: result.edges,
    externalPackages: result.externalPackages,
    stats: result.stats,
    statsByPath: [...result.statsByPath.entries()],
  });
}

describe("resolveDependencies", () => {
  it("dispatches each language to its resolver and aggregates the results", () => {
    const result = resolveDependencies(input);
    expect(
      result.edges.map((edge) => `${edge.kind}:${edge.source}->${edge.target}#${edge.weight}`),
    ).toEqual([
      "import:file:api/main.py->file:api/db.py#1",
      "import:file:svc/main.go->file:svc/store/store.go#1",
      "import:file:web/src/index.ts->file:web/src/util.ts#2",
      "import:file:web/src/util.ts->file:web/src/index.ts#1",
    ]);
    expect(result.externalPackages).toEqual(
      [
        { name: "react", importCount: 2, fileCount: 2, language: "javascript" },
        { name: "flask", importCount: 1, fileCount: 1, language: "python" },
        { name: "fmt", importCount: 1, fileCount: 1, language: "go" },
      ].sort((a, b) => b.importCount - a.importCount || (a.name < b.name ? -1 : 1)),
    );
    expect(result.stats).toEqual({
      importsFound: 9,
      importsResolved: 5,
      externalImports: 4,
      unresolvedImports: 0,
    });
  });

  it("keeps one ImportRef per parsed import, in source order", () => {
    const result = resolveDependencies(input);
    expect(result.importsByPath.get("web/src/index.ts")?.map((ref) => ref.line)).toEqual([1, 2, 3]);
    expect(result.importsByPath.get("api/db.py")).toEqual([]);
  });

  it("produces identical output for any input order", () => {
    const baseline = serialize(resolveDependencies(input));
    for (const seed of [1, 2, 3]) {
      const shuffled: DependencyResolutionInput = {
        files: shuffle(files, seed),
        graphPaths: new Set(shuffle([...input.graphPaths], seed + 10)),
        allPaths: new Set(shuffle([...input.allPaths], seed + 20)),
        configFiles: new Map(shuffle([...input.configFiles.entries()], seed + 30)),
      };
      expect(serialize(resolveDependencies(shuffled))).toBe(baseline);
    }
  });

  it("breaks external-package language ties deterministically", () => {
    // One TypeScript and one JavaScript importer: the alphabetically first language wins the tie.
    const react = resolveDependencies(input).externalPackages.find((pkg) => pkg.name === "react");
    expect(react?.language).toBe("javascript");
  });
});
