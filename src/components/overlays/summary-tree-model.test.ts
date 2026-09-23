import { describe, expect, it } from "vitest";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { buildGraphIndex } from "@/graph/model/graph-index";
import {
  ancestorsToReveal,
  revealPages,
  TREE_PAGE_SIZE,
  treeChildren,
  treeKeyAction,
  typeaheadTarget,
  visibleRows,
} from "./summary-tree-model";

const index = buildGraphIndex(mockRepositoryGraph);

describe("treeChildren", () => {
  it("lists directories first, then files, each by name", () => {
    const names = treeChildren(index, index.graph.rootDirectoryId).map(
      (child) => `${child.kind}:${child.name}`,
    );
    expect(names).toEqual([
      "directory:docs",
      "directory:packages",
      "directory:public",
      "directory:scripts",
      "directory:services",
      "directory:src",
      "directory:tests",
      "file:.gitignore",
      "file:package.json",
      "file:pnpm-lock.yaml",
      "file:README.md",
      "file:tsconfig.json",
    ]);
  });
});

describe("visibleRows", () => {
  it("only includes children of expanded directories", () => {
    const collapsed = visibleRows(index, new Set());
    expect(collapsed.every((row) => row.level === 1)).toBe(true);
    expect(collapsed).toHaveLength(12);

    const rows = visibleRows(index, new Set(["dir:src", "dir:src/auth"]));
    const src = rows.findIndex((row) => row.id === "dir:src");
    expect(rows[src + 1]).toMatchObject({
      id: "dir:src/api",
      level: 2,
      parentId: "dir:src",
      posinset: 1,
    });
    const auth = rows.findIndex((row) => row.id === "dir:src/auth");
    expect(rows[auth + 1]).toMatchObject({
      id: "file:src/auth/auth.ts",
      level: 3,
      parentId: "dir:src/auth",
    });
    // Expanding a nested directory whose parent is collapsed shows nothing.
    expect(visibleRows(index, new Set(["dir:src/auth"])).some((row) => row.level > 1)).toBe(false);
  });

  it("pages very large directories", () => {
    const files = Array.from({ length: TREE_PAGE_SIZE + 50 }, (_, i) => ({
      path: `big/f${String(i).padStart(4, "0")}.ts`,
      lines: 1,
    }));
    const big = buildGraphIndex(
      buildFixtureGraph({
        owner: "o",
        name: "r",
        referenceDate: "2026-01-01T00:00:00.000Z",
        files,
      }),
    );
    const rows = visibleRows(big, new Set(["dir:big"]));
    // Directory row + one page of files + a "show more" row.
    expect(rows).toHaveLength(1 + TREE_PAGE_SIZE + 1);
    expect(rows[rows.length - 1]).toMatchObject({
      kind: "more",
      id: "more:dir:big",
      remaining: 50,
      level: 2,
    });
    expect(rows[1]?.setsize).toBe(TREE_PAGE_SIZE + 50);
    const all = visibleRows(big, new Set(["dir:big"]), new Map([["dir:big", TREE_PAGE_SIZE * 2]]));
    expect(all).toHaveLength(1 + TREE_PAGE_SIZE + 50);

    const target = `file:big/f${String(TREE_PAGE_SIZE + 10).padStart(4, "0")}.ts`;
    const pages = revealPages(big, target, new Map());
    expect(pages.get("dir:big")).toBe(TREE_PAGE_SIZE * 2);
    const unchanged = new Map([["dir:big", TREE_PAGE_SIZE * 2]]);
    expect(revealPages(big, target, unchanged)).toBe(unchanged);
  });
});

describe("treeKeyAction", () => {
  const expanded = new Set(["dir:src"]);
  const rows = visibleRows(index, expanded);

  it("moves up and down, clamped at the ends, and jumps with Home/End", () => {
    expect(treeKeyAction(rows, "dir:docs", "ArrowDown", expanded)).toEqual({
      type: "focus",
      id: "dir:packages",
    });
    expect(treeKeyAction(rows, "dir:docs", "ArrowUp", expanded)).toEqual({
      type: "focus",
      id: "dir:docs",
    });
    expect(treeKeyAction(rows, "dir:src", "End", expanded)).toEqual({
      type: "focus",
      id: "file:tsconfig.json",
    });
    expect(treeKeyAction(rows, "dir:src", "Home", expanded)).toEqual({
      type: "focus",
      id: "dir:docs",
    });
  });

  it("expands, enters, collapses and climbs with Right/Left", () => {
    expect(treeKeyAction(rows, "dir:docs", "ArrowRight", expanded)).toEqual({
      type: "expand",
      id: "dir:docs",
    });
    expect(treeKeyAction(rows, "dir:src", "ArrowRight", expanded)).toEqual({
      type: "focus",
      id: "dir:src/api",
    });
    expect(treeKeyAction(rows, "dir:src", "ArrowLeft", expanded)).toEqual({
      type: "collapse",
      id: "dir:src",
    });
    expect(treeKeyAction(rows, "dir:src/auth", "ArrowLeft", expanded)).toEqual({
      type: "focus",
      id: "dir:src",
    });
    expect(treeKeyAction(rows, "file:README.md", "ArrowLeft", expanded)).toBeNull();
    expect(treeKeyAction(rows, "file:README.md", "ArrowRight", expanded)).toBeNull();
  });

  it("activates with Enter and Space and ignores other keys", () => {
    expect(treeKeyAction(rows, "file:README.md", "Enter", expanded)).toEqual({
      type: "activate",
      id: "file:README.md",
      kind: "file",
    });
    expect(treeKeyAction(rows, "dir:docs", " ", expanded)).toEqual({
      type: "activate",
      id: "dir:docs",
      kind: "directory",
    });
    expect(treeKeyAction(rows, "dir:docs", "x", expanded)).toBeNull();
    expect(treeKeyAction([], null, "ArrowDown", expanded)).toBeNull();
  });

  it("treats an unknown focus as the first row", () => {
    expect(treeKeyAction(rows, null, "ArrowDown", expanded)).toEqual({
      type: "focus",
      id: "dir:packages",
    });
  });
});

describe("typeahead and reveal", () => {
  it("finds the next row starting with a character, wrapping around", () => {
    const rows = visibleRows(index, new Set());
    expect(typeaheadTarget(rows, "dir:docs", "s")).toBe("dir:scripts");
    expect(typeaheadTarget(rows, "dir:scripts", "s")).toBe("dir:services");
    expect(typeaheadTarget(rows, "file:tsconfig.json", "d")).toBe("dir:docs");
    expect(typeaheadTarget(rows, "dir:docs", "z")).toBeNull();
  });

  it("lists the directories to expand to reveal a node", () => {
    expect(ancestorsToReveal(index, "file:src/api/handlers/auth.ts")).toEqual([
      "dir:src",
      "dir:src/api",
      "dir:src/api/handlers",
    ]);
    expect(ancestorsToReveal(index, "dir:src/api")).toEqual(["dir:src"]);
    expect(ancestorsToReveal(index, "file:README.md")).toEqual([]);
  });
});
