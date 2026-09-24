import { describe, expect, it } from "vitest";
import type { ParseResult, ParsedSymbol } from "@/parser/types";
import {
  MAX_GRAPH_SYMBOLS,
  MAX_IMPORTS_PER_FILE,
  MAX_SYMBOLS_PER_FILE,
  capExtraction,
  createExtractionBudget,
} from "./extraction-limits";

function parseOf(overrides: Partial<ParseResult>): ParseResult {
  return {
    language: "typescript",
    symbols: [],
    imports: [],
    exports: [],
    lines: 1,
    hasErrors: false,
    durationMs: 1,
    ...overrides,
  };
}

function fn(name: string, line: number, parentIndex?: number): ParsedSymbol {
  const symbol: ParsedSymbol = {
    name,
    kind: parentIndex === undefined ? "class" : "method",
    startLine: line,
    endLine: line,
    exported: false,
  };
  if (parentIndex !== undefined) symbol.parentIndex = parentIndex;
  return symbol;
}

describe("capExtraction", () => {
  it("returns small parses unchanged and charges the graph budget", () => {
    const parse = parseOf({
      symbols: [fn("A", 1)],
      imports: [{ specifier: "x", kind: "import", line: 1 }],
      exports: ["A"],
    });
    const budget = createExtractionBudget();
    const capped = capExtraction(parse, budget);
    expect(capped.parse).toBe(parse);
    expect(capped).toMatchObject({ droppedSymbols: 0, droppedImports: 0, droppedExports: 0 });
    expect(budget.symbols).toBe(MAX_GRAPH_SYMBOLS - 1);
  });

  it("keeps top-level symbols before nested ones and remaps parents", () => {
    // Class A (0) with methods 1..3, class B (4) with method 5: room for 4 symbols.
    const symbols = [
      fn("A", 1),
      fn("a1", 2, 0),
      fn("a2", 3, 0),
      fn("a3", 4, 0),
      fn("B", 10),
      fn("b1", 11, 4),
    ];
    const budget = { symbols: 4, imports: 10, exports: 10 };
    const capped = capExtraction(parseOf({ symbols }), budget);
    expect(capped.droppedSymbols).toBe(2);
    expect(capped.parse.symbols.map((symbol) => [symbol.name, symbol.parentIndex])).toEqual([
      ["A", undefined],
      ["a1", 0],
      ["a2", 0],
      ["B", undefined],
    ]);
    expect(budget.symbols).toBe(0);
  });

  it("caps a generated file of ten thousand functions, imports and exports", () => {
    const symbols = Array.from({ length: 10_000 }, (_, index) => fn(`f${index}`, index + 1));
    const imports = Array.from({ length: 5_000 }, (_, index) => ({
      specifier: `./m${index}`,
      kind: "import" as const,
      line: index + 1,
    }));
    const exports = symbols.map((symbol) => symbol.name);
    const capped = capExtraction(parseOf({ symbols, imports, exports }), createExtractionBudget());
    expect(capped.parse.symbols).toHaveLength(MAX_SYMBOLS_PER_FILE);
    expect(capped.parse.symbols[0]?.name).toBe("f0");
    expect(capped.parse.imports).toHaveLength(MAX_IMPORTS_PER_FILE);
    expect(capped.parse.imports.at(-1)?.line).toBe(MAX_IMPORTS_PER_FILE);
    expect(capped.droppedSymbols).toBe(10_000 - MAX_SYMBOLS_PER_FILE);
    expect(capped.droppedExports).toBeGreaterThan(0);
  });

  it("stops adding symbols once the graph-wide budget is spent", () => {
    const budget = { symbols: 3, imports: 0, exports: 1 };
    const first = capExtraction(parseOf({ symbols: [fn("A", 1), fn("B", 2)] }), budget);
    const second = capExtraction(
      parseOf({
        symbols: [fn("C", 1), fn("D", 2)],
        imports: [{ specifier: "x", kind: "import", line: 1 }],
        exports: ["C", "D"],
      }),
      budget,
    );
    expect(first.droppedSymbols).toBe(0);
    expect(second.parse.symbols.map((symbol) => symbol.name)).toEqual(["C"]);
    expect(second.parse.imports).toEqual([]);
    expect(second.parse.exports).toEqual(["C"]);
    const third = capExtraction(parseOf({ symbols: [fn("E", 1)] }), budget);
    expect(third.parse.symbols).toEqual([]);
  });

  it("treats broken or cyclic parent links as top level", () => {
    const cyclic: ParsedSymbol[] = [fn("A", 1, 1), fn("B", 2, 0), fn("C", 3, 99)];
    const capped = capExtraction(parseOf({ symbols: cyclic }), {
      symbols: 2,
      imports: 0,
      exports: 0,
    });
    expect(capped.parse.symbols).toHaveLength(2);
  });
});
