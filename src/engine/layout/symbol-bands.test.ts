import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { FileNode, SymbolKind, SymbolNode } from "@/graph/model/types";
import { computeWorldLayout } from "./compute-layout";
import { layoutSymbolBands } from "./symbol-bands";
import type { BuildingLayout, SymbolBandLayout } from "./types";

const building: BuildingLayout = {
  id: "file:a.ts",
  districtId: "dir:",
  x: 0,
  z: 0,
  width: 4,
  depth: 4,
  height: 20,
  baseY: 1,
};

function fileWith(lines: number): Pick<FileNode, "id" | "lines"> {
  return { id: "file:a.ts", lines };
}

function symbol(
  name: string,
  startLine: number,
  endLine: number,
  parent?: string,
  kind: SymbolKind = "function",
): SymbolNode {
  return {
    id: `sym:a.ts#${name}@${startLine}`,
    name,
    kind,
    fileId: "file:a.ts",
    parentSymbolId: parent,
    startLine,
    endLine,
    exported: false,
  };
}

function byName(bands: SymbolBandLayout[], name: string): SymbolBandLayout {
  const band = bands.find((item) => item.id.includes(`#${name}@`));
  if (!band) throw new Error(`no band for ${name}`);
  return band;
}

describe("layoutSymbolBands", () => {
  it("maps line ranges proportionally onto the building height", () => {
    const bands = layoutSymbolBands(
      fileWith(100),
      [symbol("f", 1, 50), symbol("g", 51, 100)],
      building,
    );
    expect(byName(bands, "f").y0).toBeCloseTo(1, 9);
    expect(byName(bands, "f").y1).toBeCloseTo(11, 9);
    expect(byName(bands, "g").y0).toBeCloseTo(11, 9);
    expect(byName(bands, "g").y1).toBeCloseTo(21, 9);
  });

  it("gives tiny symbols a minimum thickness while staying inside the building", () => {
    const bands = layoutSymbolBands(
      fileWith(10_000),
      [symbol("first", 1, 1), symbol("last", 10_000, 10_000)],
      building,
    );
    for (const band of bands) {
      expect(band.y1 - band.y0).toBeGreaterThanOrEqual(0.08 - 1e-9);
      expect(band.y0).toBeGreaterThanOrEqual(building.baseY - 1e-9);
      expect(band.y1).toBeLessThanOrEqual(building.baseY + building.height + 1e-9);
    }
    expect(byName(bands, "first").y0).toBeCloseTo(building.baseY, 9);
    expect(byName(bands, "last").y1).toBeCloseTo(building.baseY + building.height, 9);
  });

  it("nests members inside their parent with increasing depth and inset", () => {
    const bands = layoutSymbolBands(
      fileWith(300),
      [
        symbol("Service", 10, 200, undefined, "class"),
        symbol("run", 20, 60, "sym:a.ts#Service@10", "method"),
        symbol("inner", 30, 31, "sym:a.ts#run@20"),
        // A member whose range lies outside its parent is clamped into it.
        symbol("stray", 250, 290, "sym:a.ts#Service@10", "method"),
      ],
      building,
    );
    const service = byName(bands, "Service");
    const run = byName(bands, "run");
    const inner = byName(bands, "inner");
    const stray = byName(bands, "stray");
    expect([service.depth, run.depth, inner.depth, stray.depth]).toEqual([0, 1, 2, 1]);
    expect(service.inset).toBe(0);
    expect(run.inset).toBeGreaterThan(service.inset);
    expect(inner.inset).toBeGreaterThan(run.inset);
    for (const [child, parent] of [
      [run, service],
      [inner, run],
      [stray, service],
    ] as const) {
      expect(child.y0).toBeGreaterThanOrEqual(parent.y0 - 1e-9);
      expect(child.y1).toBeLessThanOrEqual(parent.y1 + 1e-9);
    }
  });

  it("is deterministic and in source order regardless of input order", () => {
    const symbols = [
      symbol("b", 40, 80),
      symbol("A", 1, 100, undefined, "class"),
      symbol("m", 5, 20, "sym:a.ts#A@1", "method"),
      symbol("c", 90, 95),
    ];
    const forward = layoutSymbolBands(fileWith(100), symbols, building);
    const backward = layoutSymbolBands(fileWith(100), [...symbols].reverse(), building);
    expect(backward).toEqual(forward);
    expect(forward.map((band) => band.id)).toEqual([
      "sym:a.ts#A@1",
      "sym:a.ts#m@5",
      "sym:a.ts#b@40",
      "sym:a.ts#c@90",
    ]);
  });

  it("ignores foreign symbols, survives parent cycles and invalid ranges", () => {
    const foreign = { ...symbol("x", 1, 5), fileId: "file:other.ts" };
    const a = symbol("a", 1, 10, "sym:a.ts#b@5");
    const b = symbol("b", 5, 8, "sym:a.ts#a@1");
    const broken = { ...symbol("broken", 1, 1), startLine: Number.NaN, endLine: -4 };
    const bands = layoutSymbolBands(fileWith(10), [foreign, a, b, broken], building);
    expect(bands.map((band) => band.id)).not.toContain(foreign.id);
    expect(bands).toHaveLength(3);
    for (const band of bands) {
      expect(Number.isFinite(band.y0) && Number.isFinite(band.y1)).toBe(true);
      expect(band.y1).toBeGreaterThan(band.y0);
    }
  });

  it("uses symbol end lines when the file's line count is unknown", () => {
    const bands = layoutSymbolBands(
      fileWith(0),
      [symbol("f", 1, 40), symbol("g", 41, 80)],
      building,
    );
    expect(byName(bands, "g").y1).toBeCloseTo(building.baseY + building.height, 9);
    expect(byName(bands, "f").y1).toBeCloseTo(building.baseY + building.height / 2, 9);
  });

  it("returns nothing for files without symbols or flat buildings", () => {
    expect(layoutSymbolBands(fileWith(10), [], building)).toEqual([]);
    expect(
      layoutSymbolBands(fileWith(10), [symbol("f", 1, 2)], { ...building, height: 0 }),
    ).toEqual([]);
  });

  it("keeps every band of the mock repository inside its building and parent", () => {
    const layout = computeWorldLayout(mockRepositoryGraph);
    const index = buildGraphIndex(mockRepositoryGraph);
    for (const target of layout.buildings) {
      const file = index.filesById.get(target.id);
      if (!file) throw new Error(`unknown file ${target.id}`);
      const symbols = file.symbolIds.flatMap((id) => index.symbolsById.get(id) ?? []);
      const bands = layoutSymbolBands(file, symbols, target);
      expect(bands).toHaveLength(symbols.length);
      const bandsById = new Map(bands.map((band) => [band.id, band] as const));
      for (const band of bands) {
        expect(band.y0).toBeGreaterThanOrEqual(target.baseY - 1e-9);
        expect(band.y1).toBeLessThanOrEqual(target.baseY + target.height + 1e-9);
        const parentId = index.symbolsById.get(band.id)?.parentSymbolId;
        const parent = parentId ? bandsById.get(parentId) : undefined;
        if (parent) {
          expect(band.depth).toBe(parent.depth + 1);
          expect(band.y0).toBeGreaterThanOrEqual(parent.y0 - 1e-9);
          expect(band.y1).toBeLessThanOrEqual(parent.y1 + 1e-9);
        }
      }
    }
  });
});
