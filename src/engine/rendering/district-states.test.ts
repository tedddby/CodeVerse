import { useExplorerStore } from "@/state/explorer-store";
import { districtStateKey, districtsToRewrite, type DistrictStateKey } from "./district-states";

const key = (patch: Partial<DistrictStateKey> = {}): DistrictStateKey => ({
  hoveredId: null,
  selectedId: null,
  focusedId: null,
  ...patch,
});

describe("districtStateKey", () => {
  it("keeps only directory hover/selection and the focus", () => {
    const base = useExplorerStore.getState();
    expect(
      districtStateKey({
        ...base,
        hovered: { kind: "file", id: "file:a.ts" },
        selection: { kind: "symbol", id: "sym:a.ts#f" },
        focusedDirectoryId: "dir:src",
      }),
    ).toEqual(key({ focusedId: "dir:src" }));
    expect(
      districtStateKey({
        ...base,
        hovered: { kind: "directory", id: "dir:src/a" },
        selection: { kind: "directory", id: "dir:src/b" },
        focusedDirectoryId: null,
      }),
    ).toEqual(key({ hoveredId: "dir:src/a", selectedId: "dir:src/b" }));
  });
});

describe("districtsToRewrite", () => {
  it("rewrites everything first and whenever focus changes", () => {
    expect(districtsToRewrite(null, key())).toBe("all");
    expect(districtsToRewrite(key(), key({ focusedId: "dir:src" }))).toBe("all");
  });

  it("rewrites nothing for building or symbol hovers (the key is unchanged)", () => {
    expect(
      districtsToRewrite(key({ focusedId: "dir:src" }), key({ focusedId: "dir:src" })),
    ).toEqual([]);
  });

  it("rewrites only the districts hovered or selected before or after", () => {
    expect(
      districtsToRewrite(
        key({ hoveredId: "dir:a", selectedId: "dir:b" }),
        key({ hoveredId: "dir:c", selectedId: "dir:b" }),
      ),
    ).toEqual(["dir:a", "dir:b", "dir:c"]);
    expect(districtsToRewrite(key({ hoveredId: "dir:a" }), key())).toEqual(["dir:a"]);
  });
});
