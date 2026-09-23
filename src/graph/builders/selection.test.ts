import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/fixtures/fixture-builder";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import type { SourceTreeEntry } from "@/sources/types";
import { buildInventory, selectGraphFiles } from "./inventory";

const entry = (path: string): SourceTreeEntry => ({ path, type: "file", size: 1_000 });
const range = (count: number, make: (index: number) => string): string[] =>
  Array.from({ length: count }, (_, index) => make(index));

function inventoryOf(paths: string[], seed?: number) {
  const entries = paths.map(entry);
  if (seed !== undefined) {
    const random = mulberry32(seed);
    entries.sort(() => random() - 0.5);
  }
  return buildInventory({ entries, truncated: false });
}

describe("selectGraphFiles", () => {
  it("keeps every file when within the limit", () => {
    const inventory = inventoryOf(["a.ts", "b/c.ts", "b/d.md"]);
    expect(selectGraphFiles(inventory, { ...DEFAULT_LIMITS, maxFiles: 3 })).toEqual(
      new Set(["a.ts", "b/c.ts", "b/d.md"]),
    );
  });

  it("selects exactly maxFiles files, deterministically for any input order", () => {
    const paths = [
      ...range(300, (i) => `src/huge/file${i}.ts`),
      ...range(20, (i) => `src/small/file${i}.ts`),
      ...range(50, (i) => `docs/page${i}.md`),
    ];
    const limits = { ...DEFAULT_LIMITS, maxFiles: 100 };
    const first = selectGraphFiles(inventoryOf(paths), limits);
    expect(first.size).toBe(100);
    for (const seed of [1, 2]) {
      expect([...selectGraphFiles(inventoryOf(paths, seed), limits)].sort()).toEqual(
        [...first].sort(),
      );
    }
  });

  it("is fair across directories: a huge directory cannot starve a small one", () => {
    const paths = [
      ...range(1_000, (i) => `packages/a/src/f${i}.ts`),
      ...range(1_000, (i) => `packages/b/src/f${i}.ts`),
      ...range(15, (i) => `packages/c/src/f${i}.ts`),
    ];
    const selected = selectGraphFiles(inventoryOf(paths), { ...DEFAULT_LIMITS, maxFiles: 415 });
    const count = (prefix: string) =>
      [...selected].filter((path) => path.startsWith(prefix)).length;
    expect(count("packages/c/")).toBe(15);
    expect(count("packages/a/")).toBe(200);
    expect(count("packages/b/")).toBe(200);
  });

  it("prioritizes source over tests, docs and assets, and hand-written over generated/vendored", () => {
    const paths = [
      ...range(40, (i) => `lib/mod${i}.py`),
      ...range(40, (i) => `lib/test_mod${i}.py`),
      ...range(40, (i) => `lib/notes${i}.md`),
      ...range(40, (i) => `lib/icon${i}.png`),
      ...range(40, (i) => `lib/gen${i}.pb.go`),
      ...range(40, (i) => `vendor/dep/x${i}.go`),
    ];
    const selected = selectGraphFiles(inventoryOf(paths), { ...DEFAULT_LIMITS, maxFiles: 100 });
    const count = (pattern: RegExp) => [...selected].filter((path) => pattern.test(path)).length;
    expect(count(/lib\/mod\d+\.py$/)).toBe(40);
    expect(count(/test_mod/)).toBe(40);
    expect(count(/\.md$/)).toBe(20);
    expect(count(/\.png$/)).toBe(0);
    expect(count(/\.pb\.go$/)).toBe(0);
    expect(count(/^vendor\//)).toBe(0);
  });

  it("gives every directory with hand-written files at least one building", () => {
    const paths = [
      ...range(500, (i) => `src/core/f${i}.ts`),
      ...range(30, (i) => `site/section${i}/index.md`),
      "LICENSE",
    ];
    const selected = selectGraphFiles(inventoryOf(paths), { ...DEFAULT_LIMITS, maxFiles: 70 });
    for (let i = 0; i < 30; i += 1) expect(selected.has(`site/section${i}/index.md`)).toBe(true);
    expect(selected.has("LICENSE")).toBe(true);
    expect(selected.size).toBe(70);
  });

  it("spends at most half of the budget on the per-directory floor", () => {
    const paths = [
      ...range(500, (i) => `src/core/f${i}.ts`),
      ...range(30, (i) => `site/section${i}/index.md`),
    ];
    const selected = selectGraphFiles(inventoryOf(paths), { ...DEFAULT_LIMITS, maxFiles: 20 });
    const core = [...selected].filter((path) => path.startsWith("src/core/")).length;
    expect(selected.size).toBe(20);
    expect(core).toBeGreaterThanOrEqual(10);
  });

  it("prefers shallower files within a priority class", () => {
    const paths = [
      "src/a.ts",
      "src/deep/er/b.ts",
      "src/deep/er/c.ts",
      "src/deep/er/d.ts",
      "src/e.ts",
    ];
    const selected = selectGraphFiles(inventoryOf(paths), { ...DEFAULT_LIMITS, maxFiles: 3 });
    // Floor: one per directory (src/a.ts, src/deep/er/b.ts); then shallow directories go first.
    expect([...selected].sort()).toEqual(["src/a.ts", "src/deep/er/b.ts", "src/e.ts"]);
  });

  it("returns an empty set for a zero limit", () => {
    expect(selectGraphFiles(inventoryOf(["a.ts"]), { ...DEFAULT_LIMITS, maxFiles: 0 }).size).toBe(
      0,
    );
  });
});
