import type { BuildingLayout, DistrictLayout } from "@/engine/layout/types";
import { arcControlPoint, buildArcBuffers, quadraticPoint, type ArcSpec } from "./arc-geometry";
import {
  OUTLINE_VERTICES_PER_DISTRICT,
  buildOutlinePositions,
  writeOutlineColor,
} from "./district-outlines";
import { INTRO_MAX_DELAY, computeIntroDelays, riseFactor } from "./intro";
import { bandBox, bandProtrusion, symbolKindGroup, symbolKindHex } from "./symbol-band-geometry";

function building(
  id: string,
  x: number,
  z: number,
  patch: Partial<BuildingLayout> = {},
): BuildingLayout {
  return { id, districtId: "dir:", x, z, width: 2, depth: 2, height: 10, baseY: 0.5, ...patch };
}

describe("intro timing", () => {
  const buildings = [building("c", 0, 0), building("mid", 30, 40), building("edge", 60, 80)];

  it("starts at the centre and delays outward up to the maximum", () => {
    const delays = computeIntroDelays(buildings, [0, 1, 2], { x: 0, z: 0 }, 100);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(0);
    expect(delays[2]).toBeCloseTo(INTRO_MAX_DELAY, 6);
    expect((delays[1] ?? 0) < (delays[2] ?? 0)).toBe(true);
  });

  it("follows the index order it is given", () => {
    const delays = computeIntroDelays(buildings, [2, 0], { x: 0, z: 0 }, 100);
    expect(delays[0]).toBeCloseTo(INTRO_MAX_DELAY, 6);
    expect(delays[1]).toBe(0);
  });

  it("eases the rise from flat to full height", () => {
    expect(riseFactor(0, 0.2)).toBe(0);
    expect(riseFactor(0.5, 0.2)).toBeGreaterThan(0);
    expect(riseFactor(5, 0.2)).toBe(1);
  });
});

describe("dependency arcs", () => {
  const arc: ArcSpec = {
    from: [0, 5, 0],
    to: [40, 2, 30],
    colorFrom: [0, 1, 1],
    colorTo: [1, 0, 1],
    intensity: 0.5,
  };

  it("lifts the apex proportionally to the span, within limits", () => {
    const short = arcControlPoint([0, 0, 0], [2, 0, 0]);
    const long = arcControlPoint([0, 0, 0], [200, 0, 0]);
    expect(long[1]).toBeGreaterThan(short[1]);
    expect(arcControlPoint([0, 0, 0], [200, 0, 0], { maxLift: 10 })[1]).toBe(10);
    expect(short[1]).toBeGreaterThanOrEqual(0.5);
  });

  it("builds two vertices per segment, from the source top to the target top", () => {
    const buffers = buildArcBuffers([arc], { segments: 10 });
    expect(buffers.vertexCount).toBe(20);
    expect(Array.from(buffers.positions.slice(0, 3))).toEqual([0, 5, 0]);
    const last = buffers.positions.slice(buffers.positions.length - 3);
    expect(last[0]).toBeCloseTo(40, 4);
    expect(last[1]).toBeCloseTo(2, 4);
    expect(last[2]).toBeCloseTo(30, 4);
  });

  it("rises above both endpoints and encodes direction as a gradient", () => {
    const buffers = buildArcBuffers([arc], { segments: 10 });
    let maxY = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < buffers.vertexCount; v += 1)
      maxY = Math.max(maxY, buffers.positions[v * 3 + 1] ?? 0);
    expect(maxY).toBeGreaterThan(5);
    // First vertex has the source color, last the target color, both scaled by intensity.
    expect(Array.from(buffers.colors.slice(0, 3))).toEqual([0, 0.5, 0.5]);
    const lastColor = Array.from(buffers.colors.slice(buffers.colors.length - 3));
    expect(lastColor[0]).toBeCloseTo(0.5, 6);
    expect(lastColor[1]).toBeCloseTo(0, 6);
  });

  it("stores monotonic progress and the arc length per vertex", () => {
    const buffers = buildArcBuffers([arc, { ...arc, from: [100, 0, 0] }], { segments: 8 });
    const perArc = 16;
    for (let a = 0; a < 2; a += 1) {
      let previous = -1;
      for (let v = a * perArc; v < (a + 1) * perArc; v += 1) {
        const progress = buffers.arcData[v * 3] ?? -1;
        expect(progress).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = progress;
      }
      expect(buffers.arcData[a * perArc * 3]).toBe(0);
      expect(buffers.arcData[((a + 1) * perArc - 1) * 3]).toBeCloseTo(1, 6);
      expect(buffers.arcData[a * perArc * 3 + 1]).toBeGreaterThan(40);
    }
  });

  it("evaluates quadratic Bézier endpoints exactly", () => {
    expect(quadraticPoint([0, 0, 0], [5, 10, 5], [10, 0, 10], 0)).toEqual([0, 0, 0]);
    expect(quadraticPoint([0, 0, 0], [5, 10, 5], [10, 0, 10], 1)).toEqual([10, 0, 10]);
    expect(quadraticPoint([0, 0, 0], [5, 10, 5], [10, 0, 10], 0.5)).toEqual([5, 5, 5]);
  });

  it("handles an empty edge set", () => {
    expect(buildArcBuffers([]).vertexCount).toBe(0);
  });
});

describe("district outlines", () => {
  const districts: DistrictLayout[] = [
    { id: "dir:", x: 0, z: 0, width: 20, depth: 10, baseY: 0, height: 0.5, level: 0, labelSize: 2 },
    {
      id: "dir:src",
      x: 2,
      z: 1,
      width: 6,
      depth: 4,
      baseY: 0.5,
      height: 0.5,
      level: 1,
      labelSize: 1,
    },
  ];

  it("traces each slab's top rectangle as 4 closed segments", () => {
    const positions = buildOutlinePositions(districts, 0.01);
    expect(positions).toHaveLength(districts.length * OUTLINE_VERTICES_PER_DISTRICT * 3);
    const second = positions.slice(OUTLINE_VERTICES_PER_DISTRICT * 3);
    for (let v = 0; v < OUTLINE_VERTICES_PER_DISTRICT; v += 1) {
      expect(second[v * 3 + 1]).toBeCloseTo(1.01, 6);
      expect(Math.abs((second[v * 3] ?? 0) - 2)).toBeCloseTo(3, 6);
      expect(Math.abs((second[v * 3 + 2] ?? 0) - 1)).toBeCloseTo(2, 6);
    }
    // Closed loop: the last segment ends where the first began.
    expect([second[21], second[23]]).toEqual([second[0], second[2]]);
  });

  it("recolors exactly one district", () => {
    const colors = new Float32Array(districts.length * OUTLINE_VERTICES_PER_DISTRICT * 3);
    writeOutlineColor(colors, 1, [1, 0.5, 0.25]);
    expect(colors.slice(0, 24).every((c) => c === 0)).toBe(true);
    expect(Array.from(colors.slice(24, 27))).toEqual([1, 0.5, 0.25]);
    writeOutlineColor(colors, 5, [1, 1, 1]);
    expect(colors).toHaveLength(48);
  });
});

describe("symbol bands", () => {
  it("groups kinds into the documented color families", () => {
    expect(symbolKindGroup("class")).toBe("structure");
    expect(symbolKindGroup("struct")).toBe("structure");
    expect(symbolKindGroup("method")).toBe("callable");
    expect(symbolKindGroup("trait")).toBe("typeLike");
    expect(symbolKindGroup("constant")).toBe("value");
    expect(symbolKindHex("function")).not.toBe(symbolKindHex("class"));
  });

  it("wraps the building, with nested bands protruding further", () => {
    const b = building("f", 3, 4, { width: 4, depth: 2 });
    const outer = bandBox(b, { y0: 1, y1: 5, depth: 0 });
    const nested = bandBox(b, { y0: 2, y1: 3, depth: 1 });
    expect(outer.width).toBeGreaterThan(b.width);
    expect(outer.depth).toBeGreaterThan(b.depth);
    expect(nested.width).toBeGreaterThan(outer.width);
    expect(outer.x).toBe(3);
    expect(outer.y).toBeGreaterThanOrEqual(1);
    expect(outer.y + outer.height).toBeLessThanOrEqual(5);
    expect(bandProtrusion(b, 2)).toBeGreaterThan(bandProtrusion(b, 1));
  });

  it("never produces degenerate boxes", () => {
    const box = bandBox(building("f", 0, 0), { y0: 2, y1: 2, depth: 0 });
    expect(box.height).toBeGreaterThan(0);
  });
});
