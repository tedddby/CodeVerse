import { describe, expect, it } from "vitest";
import { resolveMiniRepository, type MiniRepository } from "./test-support";

const monorepo: MiniRepository = {
  configs: {
    "package.json": JSON.stringify({
      name: "acme-monorepo",
      private: true,
      workspaces: ["apps/*", "packages/*"],
    }),
    "tsconfig.base.json": `{
      // Shared compiler options
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@shared/*": ["packages/shared/src/*"],
          "~config": ["packages/shared/src/config.ts"],
        },
      },
    }`,
    "apps/web/tsconfig.json": `{
      "extends": "../../tsconfig.base.json",
      /* app-local alias */
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "@shared/*": ["../../packages/shared/src/*"] } },
    }`,
    "apps/web/package.json": JSON.stringify({ name: "web", private: true }),
    "packages/ui/package.json": JSON.stringify({
      name: "@acme/ui",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs", default: "./src/index.ts" },
        "./button": "./src/button.tsx",
        "./icons/*": { import: "./src/icons/*.tsx" },
        "./package.json": "./package.json",
      },
    }),
    "packages/utils/package.json": JSON.stringify({ name: "@acme/utils", main: "dist/index.js" }),
    "packages/shared/package.json": JSON.stringify({
      name: "@acme/shared",
      imports: {
        "#internal/*": "./src/internal/*.ts",
        "#fetch": { import: "undici", default: "./src/fetch.ts" },
      },
    }),
    "packages/shared/tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
  },
  sources: {
    "apps/web/src/app.tsx": [
      "@acme/ui",
      "@acme/ui/button",
      "@acme/ui/icons/star",
      "@acme/utils",
      "@acme/utils/strings",
      "@/components/header",
      "@shared/config",
      "./lib/format.js",
      "./styles.css?inline",
      "react",
      "react-dom/client",
      "@tanstack/react-query",
      "node:fs/promises",
      "path",
      "./missing",
      "../../../../../outside",
      "@/does/not/exist",
      "npm:lodash@4/fp",
    ],
    "apps/web/src/lib/format.ts": [
      { specifier: "./format", kind: "import" },
      "../components/header/index",
    ],
    "apps/web/src/components/header/index.tsx": [
      { specifier: "@acme/ui/button", kind: "type-import" },
      { specifier: "@acme/ui/button", kind: "import" },
      { specifier: "@acme/ui/button", kind: "import" },
    ],
    "packages/ui/src/index.ts": [
      { specifier: "./button", kind: "re-export" },
      { specifier: "./icons/star.js", kind: "re-export" },
    ],
    "packages/ui/src/button.tsx": ["react", "clsx"],
    "packages/ui/src/icons/star.tsx": ["react"],
    "packages/utils/src/index.ts": ["./strings"],
    "packages/utils/src/strings.ts": [],
    "packages/shared/src/config.ts": ["#internal/env", "#fetch", "~config"],
    "packages/shared/src/internal/env.ts": [],
    "packages/shared/src/fetch.ts": [],
    "scripts/build.mjs": [
      { specifier: "../packages/utils/src/index.js", kind: "require" },
      "./data",
    ],
  },
  files: ["apps/web/src/styles.css", "scripts/data.json", "packages/ui/README.md"],
  omitted: ["scripts/data.json"],
};

describe("TypeScript/JavaScript resolution", () => {
  const repo = resolveMiniRepository(monorepo);
  const app = "apps/web/src/app.tsx";

  it("resolves workspace packages through exports maps, preferring source over dist", () => {
    expect(repo.target(app, "@acme/ui")).toBe("packages/ui/src/index.ts");
    expect(repo.target(app, "@acme/ui/button")).toBe("packages/ui/src/button.tsx");
    expect(repo.target(app, "@acme/ui/icons/star")).toBe("packages/ui/src/icons/star.tsx");
  });

  it("falls back to src/index and subpath probing when main points at unbuilt output", () => {
    expect(repo.target(app, "@acme/utils")).toBe("packages/utils/src/index.ts");
    expect(repo.target(app, "@acme/utils/strings")).toBe("packages/utils/src/strings.ts");
  });

  it("applies the nearest tsconfig paths and baseUrl, following extends", () => {
    expect(repo.target(app, "@/components/header")).toBe(
      "apps/web/src/components/header/index.tsx",
    );
    expect(repo.target(app, "@shared/config")).toBe("packages/shared/src/config.ts");
  });

  it("maps .js specifiers to TypeScript sources and strips bundler queries", () => {
    expect(repo.target(app, "./lib/format.js")).toBe("apps/web/src/lib/format.ts");
    expect(repo.target(app, "./styles.css?inline")).toBe("apps/web/src/styles.css");
    expect(repo.target("packages/ui/src/index.ts", "./icons/star.js")).toBe(
      "packages/ui/src/icons/star.tsx",
    );
  });

  it("classifies packages and Node builtins as external with normalized names", () => {
    for (const specifier of [
      "react",
      "react-dom/client",
      "@tanstack/react-query",
      "node:fs/promises",
      "path",
    ]) {
      expect(repo.ref(app, specifier).external).toBe(true);
    }
    const names = repo.result.externalPackages.map((pkg) => pkg.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "react",
        "react-dom",
        "@tanstack/react-query",
        "node:fs",
        "node:path",
        "lodash",
        "clsx",
      ]),
    );
    const react = repo.result.externalPackages.find((pkg) => pkg.name === "react");
    expect(react).toMatchObject({ importCount: 3, fileCount: 3, language: "typescript" });
    // Sorted by import count, then name.
    expect(repo.result.externalPackages[0]?.name).toBe("react");
  });

  it("leaves missing relative files, escapes and unknown aliases unresolved (not external)", () => {
    for (const specifier of ["./missing", "../../../../../outside", "@/does/not/exist"]) {
      const ref = repo.ref(app, specifier);
      expect(ref.external).toBe(false);
      expect(ref.resolvedFileId).toBeUndefined();
    }
  });

  it("resolves package.json subpath imports and exact tsconfig aliases", () => {
    const config = "packages/shared/src/config.ts";
    expect(repo.target(config, "#internal/env")).toBe("packages/shared/src/internal/env.ts");
    // Conditions are tried in preference order; "import" maps to a bare package, so it is external.
    expect(repo.ref(config, "#fetch").external).toBe(true);
    expect(repo.result.externalPackages.map((pkg) => pkg.name)).toContain("undici");
    // packages/shared/tsconfig.json has no paths, so the root alias does not apply here, and an
    // alias-looking specifier is never mistaken for an npm package.
    expect(repo.ref(config, "~config")).toMatchObject({ external: false });
    expect(repo.ref(config, "~config").resolvedFileId).toBeUndefined();
  });

  it("counts imports of repository files that are not FileNodes as resolved without edges", () => {
    const ref = repo.ref("scripts/build.mjs", "./data");
    expect(ref.resolvedFileId).toBeUndefined();
    expect(ref.external).toBe(false);
    expect(repo.result.statsByPath.get("scripts/build.mjs")).toEqual({
      importsFound: 2,
      importsResolved: 2,
      externalImports: 0,
      unresolvedImports: 0,
    });
    expect(repo.target("scripts/build.mjs", "../packages/utils/src/index.js")).toBe(
      "packages/utils/src/index.ts",
    );
  });

  it("aggregates edges per (source, target, kind) and never emits self-edges", () => {
    const header = "file:apps/web/src/components/header/index.tsx";
    const edges = repo.result.edges.filter((edge) => edge.source === header);
    expect(edges.map((edge) => [edge.kind, edge.weight])).toEqual([
      ["import", 2],
      ["type-import", 1],
    ]);
    expect(repo.result.edges.some((edge) => edge.source === edge.target)).toBe(false);
    const format = repo.ref("apps/web/src/lib/format.ts", "./format");
    expect(format.resolvedFileId).toBeUndefined();
    const ids = repo.result.edges.map((edge) => edge.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("keeps the totals consistent", () => {
    const { stats } = repo.result;
    expect(stats.importsFound).toBe(
      stats.importsResolved + stats.externalImports + stats.unresolvedImports,
    );
    const refs = [...repo.result.importsByPath.values()].flat();
    expect(refs).toHaveLength(stats.importsFound);
    expect(refs.filter((ref) => ref.external)).toHaveLength(stats.externalImports);
  });
});

describe("TypeScript resolution edge cases", () => {
  it("follows solution-style references and array extends", () => {
    const repo = resolveMiniRepository({
      configs: {
        "tsconfig.json": `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }`,
        "tsconfig.app.json": `{ "extends": ["./tsconfig.paths.json"], "compilerOptions": {} }`,
        "tsconfig.paths.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      },
      sources: { "src/main.ts": ["@/util"], "src/util.ts": [] },
    });
    expect(repo.target("src/main.ts", "@/util")).toBe("src/util.ts");
  });

  it("resolves paths relative to the config that declares them when there is no baseUrl", () => {
    const repo = resolveMiniRepository({
      configs: {
        "config/tsconfig.shared.json": `{ "compilerOptions": { "paths": { "lib/*": ["../lib/*"] } } }`,
        "tsconfig.json": `{ "extends": "./config/tsconfig.shared" }`,
      },
      sources: { "app/main.ts": ["lib/math"], "lib/math.ts": [] },
    });
    expect(repo.target("app/main.ts", "lib/math")).toBe("lib/math.ts");
  });

  it("resolves extends through a workspace config package", () => {
    const repo = resolveMiniRepository({
      configs: {
        "packages/tsconfig/package.json": JSON.stringify({ name: "@repo/tsconfig" }),
        "packages/tsconfig/base.json": `{ "compilerOptions": { "baseUrl": "../..", "paths": { "@lib/*": ["libs/*"] } } }`,
        "apps/api/tsconfig.json": `{ "extends": "@repo/tsconfig/base.json" }`,
      },
      sources: { "apps/api/server.ts": ["@lib/db"], "libs/db/index.ts": [] },
    });
    expect(repo.target("apps/api/server.ts", "@lib/db")).toBe("libs/db/index.ts");
  });

  it("survives extends cycles and malformed configs", () => {
    const repo = resolveMiniRepository({
      configs: {
        "tsconfig.json": `{ "extends": "./b.json", "compilerOptions": { "baseUrl": "src" } }`,
        "b.json": `{ "extends": "./tsconfig.json" }`,
        "pkg/tsconfig.json": "{ not json",
        "pkg/package.json": "{ also not json",
      },
      sources: { "src/a.ts": ["b"], "src/b.ts": [], "pkg/x.ts": ["b", "left-pad"] },
    });
    expect(repo.target("src/a.ts", "b")).toBe("src/b.ts");
    expect(repo.ref("pkg/x.ts", "b").external).toBe(true);
    expect(repo.ref("pkg/x.ts", "left-pad").external).toBe(true);
  });

  it("handles protocol specifiers from Deno, JSR and bundlers", () => {
    const repo = resolveMiniRepository({
      sources: {
        "mod.ts": [
          "https://deno.land/std@0.200.0/path/mod.ts",
          "jsr:@std/path@1",
          "virtual:pwa-register",
          "bun:test",
        ],
      },
    });
    expect(repo.result.externalPackages.map((pkg) => pkg.name).sort()).toEqual([
      "bun:test",
      "deno.land",
      "jsr:@std/path",
      "virtual:pwa-register",
    ]);
  });

  it("prefers exact files, then extensions, then index files", () => {
    const repo = resolveMiniRepository({
      sources: { "src/main.js": ["./a", "./b", "./c.js", "./d"] },
      files: [
        "src/a.ts",
        "src/a/index.ts",
        "src/b/index.jsx",
        "src/c.js",
        "src/c.ts",
        "src/d.d.ts",
      ],
    });
    expect(repo.target("src/main.js", "./a")).toBe("src/a.ts");
    expect(repo.target("src/main.js", "./b")).toBe("src/b/index.jsx");
    expect(repo.target("src/main.js", "./c.js")).toBe("src/c.js");
    expect(repo.target("src/main.js", "./d")).toBe("src/d.d.ts");
  });
});
