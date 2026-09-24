import {
  DISTRICT_LABEL_BUDGET,
  LABEL_LETTER_SPACING_EM,
  UPPERCASE_ADVANCE_EM,
  estimateLabelWidth,
  labelPixelSize,
  rectsOverlap,
  selectDistrictLabels,
  type LabelCandidate,
  type LabelSelectionOptions,
} from "./district-labels";
import { pixelsPerWorldUnit, projectedSizePx } from "./projection";

function district(id: string, patch: Partial<LabelCandidate> = {}): LabelCandidate {
  return { id, x: 0, z: 0, topY: 0, width: 10, depth: 10, level: 1, inFocus: true, ...patch };
}

const baseOptions: LabelSelectionOptions = {
  camera: { x: 0, y: 100, z: 0 },
  fovY: 45,
  viewportHeight: 1000,
  minPixelSize: 80,
  sublinePixelSize: 220,
};

describe("projection", () => {
  it("halves projected size when distance doubles", () => {
    const near = projectedSizePx(10, 50, 45, 1000);
    const far = projectedSizePx(10, 100, 45, 1000);
    expect(near / far).toBeCloseTo(2, 6);
  });

  it("maps the full view height to the viewport at any distance", () => {
    const distance = 80;
    const halfHeight = Math.tan((45 * Math.PI) / 360) * distance;
    expect(pixelsPerWorldUnit(distance, 45, 1000) * halfHeight * 2).toBeCloseTo(1000, 6);
  });
});

describe("selectDistrictLabels", () => {
  it("drops districts that are too small on screen", () => {
    const picks = selectDistrictLabels(
      [district("big", { width: 60 }), district("tiny", { width: 2, depth: 2 })],
      baseOptions,
    );
    expect(picks.map((p) => p.id)).toEqual(["big"]);
  });

  it("drops districts that fill the screen (the camera is inside them)", () => {
    const picks = selectDistrictLabels(
      [district("huge", { width: 2_000 }), district("big", { width: 60 })],
      {
        ...baseOptions,
        maxPixelSize: 2_000,
      },
    );
    expect(picks.map((p) => p.id)).toEqual(["big"]);
  });

  it("never exceeds the budget (hard-capped at 40)", () => {
    const many = Array.from({ length: 120 }, (_, i) => district(`d${i}`, { width: 80, depth: 80 }));
    expect(selectDistrictLabels(many, baseOptions)).toHaveLength(DISTRICT_LABEL_BUDGET);
    expect(selectDistrictLabels(many, { ...baseOptions, budget: 500 })).toHaveLength(
      DISTRICT_LABEL_BUDGET,
    );
    expect(selectDistrictLabels(many, { ...baseOptions, budget: 5 })).toHaveLength(5);
    expect(selectDistrictLabels(many, { ...baseOptions, budget: 0 })).toHaveLength(0);
  });

  it("prefers top-level districts, then larger projected size", () => {
    const picks = selectDistrictLabels(
      [
        district("nested-huge", { level: 3, width: 90 }),
        district("top-small", { level: 1, width: 40 }),
        district("top-large", { level: 1, width: 70 }),
      ],
      { ...baseOptions, budget: 2 },
    );
    expect(picks.map((p) => p.id)).toEqual(["top-large", "top-small"]);
  });

  it("puts in-focus districts before the rest and always includes the pinned one", () => {
    const picks = selectDistrictLabels(
      [
        district("outside", { level: 1, width: 90, inFocus: false }),
        district("inside", { level: 2, width: 50 }),
        district("pinned", { level: 4, width: 0.5, depth: 0.5 }),
      ],
      { ...baseOptions, pinnedId: "pinned" },
    );
    expect(picks.map((p) => p.id)).toEqual(["pinned", "inside", "outside"]);
    expect(picks[0]?.subline).toBe(true);
  });

  it("adds sublines only for large districts", () => {
    const picks = selectDistrictLabels(
      [district("large", { width: 30 }), district("medium", { width: 12, depth: 12 })],
      baseOptions,
    );
    expect(picks.find((p) => p.id === "large")?.subline).toBe(true);
    expect(picks.find((p) => p.id === "medium")?.subline).toBe(false);
  });

  it("keeps previously shown labels slightly below the threshold (hysteresis)", () => {
    // ~12 px per world unit at distance 100 with a 45° fov on a 1000px viewport.
    const candidate = district("edge", { width: 7.5, depth: 7.5 });
    const size = projectedSizePx(7.5, 100, 45, 1000);
    const options = { ...baseOptions, minPixelSize: size * 1.05 };
    expect(selectDistrictLabels([candidate], options)).toHaveLength(0);
    expect(
      selectDistrictLabels([candidate], { ...options, previous: new Set(["edge"]) }),
    ).toHaveLength(1);
  });

  it("lets oversized parents yield to their sub-districts, without a subline", () => {
    const picks = selectDistrictLabels(
      [
        district("parent", { level: 1, width: 120, depth: 120, hasChildren: true }),
        district("child-a", { level: 2, width: 40 }),
        district("child-b", { level: 2, width: 30 }),
      ],
      { ...baseOptions, yieldPixelSize: 1_000 },
    );
    expect(picks.map((p) => p.id)).toEqual(["child-a", "child-b", "parent"]);
    expect(picks.find((p) => p.id === "parent")?.subline).toBe(false);
  });

  it("keeps hierarchy order for parents that are not oversized, and for leaves", () => {
    const picks = selectDistrictLabels(
      [
        district("child", { level: 2, width: 40 }),
        district("parent", { level: 1, width: 60, hasChildren: true }),
        district("huge-leaf", { level: 1, width: 120, depth: 120 }),
      ],
      { ...baseOptions, yieldPixelSize: 1_000 },
    );
    expect(picks.map((p) => p.id)).toEqual(["huge-leaf", "parent", "child"]);
    expect(picks.find((p) => p.id === "parent")?.subline).toBe(true);
  });

  it("runs the visibility test only for districts that pass the size tests", () => {
    const tested: string[] = [];
    selectDistrictLabels(
      [district("big", { width: 60 }), district("tiny", { width: 1, depth: 1 })],
      {
        ...baseOptions,
        isVisible: (candidate) => {
          tested.push(candidate.id);
          return true;
        },
      },
    );
    expect(tested).toEqual(["big"]);
  });

  it("respects the visibility test except for the pinned district", () => {
    const options = { ...baseOptions, isVisible: () => false, pinnedId: "p" };
    const picks = selectDistrictLabels(
      [district("a", { width: 80 }), district("p", { width: 80 })],
      options,
    );
    expect(picks.map((p) => p.id)).toEqual(["p"]);
  });
});

describe("labelPixelSize", () => {
  it("encodes hierarchy and emphasizes the focused district", () => {
    expect(labelPixelSize(1, false)).toBeGreaterThan(labelPixelSize(2, false));
    expect(labelPixelSize(2, false)).toBeGreaterThan(labelPixelSize(5, false));
    expect(labelPixelSize(5, true)).toBeGreaterThan(labelPixelSize(1, false));
  });
});

describe("estimateLabelWidth", () => {
  it("grows linearly with characters and size, counting code points", () => {
    const perChar = UPPERCASE_ADVANCE_EM * (1 + LABEL_LETTER_SPACING_EM);
    expect(estimateLabelWidth("AUTH", 10)).toBeCloseTo(4 * 10 * perChar, 9);
    expect(estimateLabelWidth("AUTH", 20)).toBeCloseTo(2 * estimateLabelWidth("AUTH", 10), 9);
    expect(estimateLabelWidth("日本", 10)).toBeCloseTo(2 * 10 * perChar, 9);
  });
});

describe("rectsOverlap", () => {
  it("detects overlap and treats touching edges as separate", () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    expect(rectsOverlap(a, { minX: 1, maxX: 3, minY: 1, maxY: 3 })).toBe(true);
    expect(rectsOverlap(a, { minX: 2, maxX: 3, minY: 0, maxY: 2 })).toBe(false);
  });
});
