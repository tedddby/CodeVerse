/**
 * A realistic multi-language repository for pipeline integration tests:
 * a TypeScript monorepo (workspace package + tsconfig paths), a Python
 * package, a Go module, a Rust crate and a Java package, plus the awkward
 * cases every real repository has (binary assets, oversized files, a file
 * whose download fails, a source file with syntax errors).
 */
import type { MemoryFileSpec, MemorySourceSpec } from "@/sources/memory";
import type { SourceCommitDetails } from "@/sources/types";

export const REPOSITORY = {
  owner: "acme",
  name: "polyglot",
  provider: "github" as const,
  description: "Polyglot fixture repository",
  defaultBranch: "main",
  createdAt: "2025-01-06T00:00:00.000Z",
  stars: 1_234,
  forks: 56,
};

/** Fixed analysis clock: every run with it produces identical output. */
export const FIXED_NOW = Date.parse("2026-09-23T12:00:00.000Z");

/** Limits small enough to exercise size handling with small fixtures. */
export const TEST_LIMITS = {
  maxFileBytes: 64 * 1024,
  maxParseBytes: 32 * 1024,
};

function lines(...content: string[]): string {
  return `${content.join("\n")}\n`;
}

/** ~40 KB of valid TypeScript: downloaded and line-counted, too large to parse. */
function mediumTable(): string {
  const rows = Array.from({ length: 1_800 }, (_, index) => `  ${index}, // row number ${index}`);
  return lines("export const TABLE = [", ...rows, "];");
}

/** ~90 KB of TypeScript: over `maxFileBytes`, never downloaded. */
function hugeTable(): string {
  const rows = Array.from({ length: 4_000 }, (_, index) => `  "value-${index}-padding",`);
  return lines("export const HUGE = [", ...rows, "];");
}

export const FILES: Record<string, MemoryFileSpec> = {
  "README.md": lines("# Polyglot", "", "Fixture repository."),
  "package.json": JSON.stringify({
    name: "acme-polyglot",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@web/*": ["apps/web/src/*"] } },
  }),
  "apps/web/package.json": JSON.stringify({
    name: "@acme/web",
    version: "1.0.0",
    dependencies: { "@acme/utils": "workspace:*", react: "^19.0.0" },
  }),
  "apps/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json" }),
  "apps/web/src/index.ts": lines(
    'import { greet, Greeter } from "@acme/utils";',
    'import { formatName } from "@web/lib/format";',
    'import { useState } from "react";',
    "",
    "export function main(): string {",
    '  return greet(formatName(" world "));',
    "}",
    "",
    "export class App extends Greeter {",
    "  render(): string {",
    '    return this.greet("app");',
    "  }",
    "}",
    "",
    "export const hook = useState;",
  ),
  "apps/web/src/lib/format.ts": lines(
    "export function formatName(name: string): string {",
    "  return name.trim();",
    "}",
  ),
  "apps/web/src/table.ts": mediumTable(),
  "packages/utils/package.json": JSON.stringify({
    name: "@acme/utils",
    version: "1.0.0",
    main: "src/index.ts",
  }),
  "packages/utils/src/index.ts": lines(
    "export function greet(name: string): string {",
    "  return `Hello ${name}`;",
    "}",
    "",
    "export class Greeter {",
    "  greet(name: string): string {",
    "    return greet(name);",
    "  }",
    "}",
    "",
    'export { helper } from "./helper";',
  ),
  "packages/utils/src/helper.ts": lines("export const helper = (): number => 1;"),
  "packages/utils/src/broken.ts": lines(
    "export function broken( {",
    "  return 1",
    "",
    "export function stillFound(): number {",
    "  return 2;",
    "}",
  ),
  "packages/utils/src/huge.ts": hugeTable(),
  "python/acme/__init__.py": lines('"""Acme package."""'),
  "python/acme/main.py": lines(
    "import os",
    "from .models import User",
    "",
    "",
    "def run() -> User:",
    "    return User(os.getcwd())",
  ),
  "python/acme/models.py": lines(
    "class User:",
    "    def __init__(self, name: str) -> None:",
    "        self.name = name",
    "",
    "    def display(self) -> str:",
    "        return self.name",
  ),
  "go.mod": lines("module example.com/acme", "", "go 1.22"),
  "cmd/server/main.go": lines(
    "package main",
    "",
    "import (",
    '\t"fmt"',
    "",
    '\t"example.com/acme/internal/store"',
    ")",
    "",
    "func main() {",
    "\tfmt.Println(store.Open())",
    "}",
  ),
  "internal/store/store.go": lines(
    "package store",
    "",
    "// Open opens the store.",
    "func Open() string {",
    '\treturn "ok"',
    "}",
  ),
  "crates/core/Cargo.toml": lines("[package]", 'name = "acme_core"', 'version = "0.1.0"'),
  "crates/core/src/lib.rs": lines(
    "mod util;",
    "",
    "pub fn run() -> u32 {",
    "    util::helper()",
    "}",
  ),
  "crates/core/src/util.rs": lines("pub fn helper() -> u32 {", "    1", "}"),
  "java/src/main/java/com/acme/App.java": lines(
    "package com.acme;",
    "",
    "import com.acme.util.Strings;",
    "",
    "public class App {",
    "  public static void main(String[] args) {",
    '    System.out.println(Strings.upper("x"));',
    "  }",
    "}",
  ),
  "java/src/main/java/com/acme/util/Strings.java": lines(
    "package com.acme.util;",
    "",
    "public final class Strings {",
    "  public static String upper(String value) {",
    "    return value.toUpperCase();",
    "  }",
    "}",
  ),
  "docs/guide.md": lines("# Guide", "", "How to use the fixture."),
  "docs/flaky.md": { unreadable: true, size: 240 },
  "assets/logo.png": { binary: true, size: 2_048 },
};

function sha(seed: number): string {
  return seed.toString(16).padStart(8, "0").repeat(5);
}

export const COMMITS: SourceCommitDetails[] = [
  {
    sha: sha(3),
    message: "Add Rust crate and Java package",
    authorName: "Ada Lovelace",
    authorLogin: "ada",
    date: "2026-09-20T10:00:00.000Z",
    url: `https://github.com/acme/polyglot/commit/${sha(3)}`,
    additions: 40,
    deletions: 2,
    files: [
      "crates/core/src/lib.rs",
      "crates/core/src/util.rs",
      "java/src/main/java/com/acme/App.java",
    ],
  },
  {
    sha: sha(2),
    message: "Add Python and Go services",
    authorName: "Grace Hopper",
    authorLogin: "grace",
    date: "2026-08-02T09:30:00.000Z",
    url: `https://github.com/acme/polyglot/commit/${sha(2)}`,
    additions: 60,
    deletions: 0,
    files: ["python/acme/main.py", "python/acme/models.py", "cmd/server/main.go"],
  },
  {
    sha: sha(1),
    message: "Initial TypeScript monorepo",
    authorName: "Ada Lovelace",
    authorLogin: "ada",
    date: "2025-01-06T08:00:00.000Z",
    url: `https://github.com/acme/polyglot/commit/${sha(1)}`,
    additions: 120,
    deletions: 0,
    files: ["apps/web/src/index.ts", "packages/utils/src/index.ts", "README.md"],
  },
];

export function polyglotSpec(overrides: Partial<MemorySourceSpec> = {}): MemorySourceSpec {
  return {
    repository: { ...REPOSITORY },
    files: { ...FILES },
    commits: COMMITS,
    capabilities: { fileHistory: true, commitCounts: true },
    rateLimit: {
      limit: 5_000,
      remaining: 4_200,
      resetAt: "2026-09-23T13:00:00.000Z",
      authenticated: true,
    },
    ...overrides,
  };
}
