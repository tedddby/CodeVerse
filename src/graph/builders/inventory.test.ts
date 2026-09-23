import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import type { SourceTree, SourceTreeEntry } from "@/sources/types";
import { buildInventory, determineTier, isResolutionConfigFile } from "./inventory";

const file = (path: string, size = 100): SourceTreeEntry => ({ path, type: "file", size });

describe("buildInventory", () => {
  const tree: SourceTree = {
    truncated: true,
    entries: [
      file("src/index.ts", 1200),
      file("src/components/Button.tsx", 800),
      file("src/components/Button.test.tsx", 400),
      file("README.md", 300),
      file("docs/guide/intro.md", 500),
      file("assets/logo.png", 20_000),
      file("pnpm-lock.yaml", 90_000),
      file("vendor/lib/jquery.js", 30_000),
      file("Makefile", 50),
      file("scripts/deploy.sh", 70),
      { path: "extern/submodule", type: "submodule", size: 0 },
      { path: "link-to-src", type: "symlink", size: 0 },
      { path: "src/index.ts", type: "file", size: 999 },
      { path: "../escape.ts", type: "file", size: 1 },
      { path: "a//b.ts", type: "file", size: 1 },
      { path: "neg.ts", type: "file", size: -5 },
    ],
  };
  const inventory = buildInventory(tree);
  const byPath = new Map(inventory.files.map((entry) => [entry.path, entry] as const));

  it("keeps regular files only, sorted, first entry wins on duplicates, unrepresentable paths dropped", () => {
    const paths = inventory.files.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain("extern/submodule");
    expect(paths).not.toContain("../escape.ts");
    expect(paths).not.toContain("a//b.ts");
    expect(byPath.get("src/index.ts")?.size).toBe(1200);
    expect(byPath.get("neg.ts")?.size).toBe(0);
    expect(inventory.excluded).toEqual({ submodules: 1, symlinks: 1 });
    expect(inventory.truncated).toBe(true);
  });

  it("classifies language, parser, category, generated and binary flags", () => {
    expect(byPath.get("src/components/Button.tsx")).toMatchObject({
      language: "typescript",
      parserLanguage: "tsx",
      category: "source",
      isGenerated: false,
      isBinary: false,
      depth: 2,
    });
    expect(byPath.get("src/components/Button.test.tsx")?.category).toBe("test");
    expect(byPath.get("README.md")).toMatchObject({
      language: "markdown",
      parserLanguage: null,
      category: "docs",
      depth: 0,
    });
    expect(byPath.get("assets/logo.png")).toMatchObject({ isBinary: true, category: "asset" });
    expect(byPath.get("pnpm-lock.yaml")?.isGenerated).toBe(true);
    expect(byPath.get("vendor/lib/jquery.js")).toMatchObject({
      isGenerated: true,
      category: "vendor",
    });
    expect(byPath.get("Makefile")).toMatchObject({ language: "makefile", category: "build" });
  });

  it("lists every ancestor directory including the root, and totals bytes", () => {
    expect(inventory.directories).toEqual([
      "",
      "assets",
      "docs",
      "docs/guide",
      "scripts",
      "src",
      "src/components",
      "vendor",
      "vendor/lib",
    ]);
    expect(inventory.totalBytes).toBe(inventory.files.reduce((sum, entry) => sum + entry.size, 0));
  });

  it("handles an empty tree", () => {
    const empty = buildInventory({ entries: [], truncated: false });
    expect(empty).toEqual({
      files: [],
      directories: [""],
      excluded: { submodules: 0, symlinks: 0 },
      totalBytes: 0,
      truncated: false,
    });
  });
});

describe("determineTier", () => {
  it("uses inclusive tier boundaries", () => {
    const limits = { ...DEFAULT_LIMITS, tierFullMax: 10, tierProgressiveMax: 100 };
    expect(determineTier(0, limits)).toBe("full");
    expect(determineTier(10, limits)).toBe("full");
    expect(determineTier(11, limits)).toBe("progressive");
    expect(determineTier(100, limits)).toBe("progressive");
    expect(determineTier(101, limits)).toBe("directory-first");
  });
});

describe("isResolutionConfigFile", () => {
  it.each([
    ["package.json", true],
    ["packages/ui/package.json", true],
    ["tsconfig.json", true],
    ["apps/web/tsconfig.app.json", true],
    ["tsconfig.base.json", true],
    ["jsconfig.json", true],
    ["go.mod", true],
    ["crates/core/Cargo.toml", true],
    ["pyproject.toml", true],
    ["setup.cfg", true],
    ["setup.py", true],
    ["package-lock.json", false],
    ["go.sum", false],
    ["Cargo.lock", false],
    ["tsconfig.json.bak", false],
    ["mytsconfig.json", false],
  ])("%s -> %s", (path, expected) => {
    expect(isResolutionConfigFile(path)).toBe(expected);
  });
});
