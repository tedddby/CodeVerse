import {
  SYMBOL_BUILDING_BUDGET,
  selectSymbolBuildings,
  selectSymbolLabels,
  type BandBuildingCandidate,
} from "./symbols";

function building(
  id: string,
  x: number,
  patch: Partial<BandBuildingCandidate> = {},
): BandBuildingCandidate {
  return { id, x, z: 0, baseY: 0, width: 2, depth: 2, height: 10, ...patch };
}

const everyFileHasSymbols = () => true;

describe("selectSymbolBuildings", () => {
  it("picks buildings near the camera relative to their size, nearest first", () => {
    const buildings = [building("far", 500), building("near", 5), building("mid", 30)];
    const picks = selectSymbolBuildings(buildings, {
      camera: { x: 0, y: 5, z: 10 },
      selectedFileId: null,
      hasSymbols: everyFileHasSymbols,
    });
    expect(picks).toEqual(["near", "mid"]);
  });

  it("always includes the selected building first, even when far away", () => {
    const picks = selectSymbolBuildings([building("near", 1), building("selected", 10_000)], {
      camera: { x: 0, y: 5, z: 5 },
      selectedFileId: "selected",
      hasSymbols: everyFileHasSymbols,
    });
    expect(picks[0]).toBe("selected");
    expect(picks).toContain("near");
  });

  it("skips files without symbols (including a symbol-less selection)", () => {
    const picks = selectSymbolBuildings([building("empty", 1), building("full", 2)], {
      camera: { x: 0, y: 5, z: 5 },
      selectedFileId: "empty",
      hasSymbols: (id) => id !== "empty",
    });
    expect(picks).toEqual(["full"]);
  });

  it("respects the hard budget", () => {
    const crowd = Array.from({ length: 200 }, (_, i) =>
      building(`b${i}`, (i % 20) * 0.5, { z: Math.floor(i / 20) * 0.5 }),
    );
    const picks = selectSymbolBuildings(crowd, {
      camera: { x: 5, y: 5, z: 5 },
      selectedFileId: null,
      hasSymbols: everyFileHasSymbols,
      budget: 1_000,
    });
    expect(picks).toHaveLength(SYMBOL_BUILDING_BUDGET);
    expect(new Set(picks).size).toBe(picks.length);
  });

  it("applies the visibility test", () => {
    const picks = selectSymbolBuildings([building("hidden", 1), building("shown", 2)], {
      camera: { x: 0, y: 5, z: 5 },
      selectedFileId: null,
      hasSymbols: everyFileHasSymbols,
      isVisible: (candidate) => candidate.id === "shown",
    });
    expect(picks).toEqual(["shown"]);
  });
});

describe("selectSymbolLabels", () => {
  it("chooses the largest bands and skips ones that would overlap", () => {
    const bands = [
      { id: "class", y0: 0, y1: 10 },
      { id: "method-a", y0: 4.8, y1: 5.4 },
      { id: "fn", y0: 12, y1: 16 },
      { id: "const", y0: 16.5, y1: 16.6 },
    ];
    const chosen = selectSymbolLabels(bands, 1);
    expect(chosen.map((b) => b.id)).toEqual(["class", "fn", "const"]);
  });

  it("returns labels bottom to top and respects the budget", () => {
    const bands = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, y0: i * 2, y1: i * 2 + 1 }));
    const chosen = selectSymbolLabels(bands, 0.5, 10);
    expect(chosen).toHaveLength(10);
    const starts = chosen.map((b) => b.y0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("caps the budget at 25", () => {
    const bands = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, y0: i * 2, y1: i * 2 + 1 }));
    expect(selectSymbolLabels(bands, 0.5, 100)).toHaveLength(25);
  });
});
