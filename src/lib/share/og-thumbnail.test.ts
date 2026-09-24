import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION, type WorldLayout } from "@/engine/layout/types";
import {
  generateAbstractMap,
  hashString,
  projectCityMap,
  seededRandom,
  shadeColor,
  type OgThumbnail,
} from "./og-thumbnail";
import { svgDataUri, thumbnailToSvg } from "./og-thumbnail-svg";

const BOX = { width: 560, height: 460, padding: 12 };

function layoutFixture(buildingCount: number): WorldLayout {
  const buildings = Array.from({ length: buildingCount }, (_, index) => ({
    id: `file:f${index}.ts`,
    districtId: "dir:",
    x: -100 + (index % 40) * 5,
    z: -50 + Math.floor(index / 40) * 5,
    width: 3,
    depth: 3,
    height: 1 + (index % 17),
    baseY: 0.5,
  }));
  return {
    version: LAYOUT_VERSION,
    key: "fixture",
    bounds: { minX: -102, maxX: 102, minZ: -52, maxZ: 52, maxY: 18, size: 204 },
    districts: [
      {
        id: "dir:",
        x: 0,
        z: 0,
        width: 204,
        depth: 104,
        baseY: 0,
        height: 0.5,
        level: 0,
        labelSize: 4,
      },
      {
        id: "dir:src",
        x: -50,
        z: 0,
        width: 80,
        depth: 60,
        baseY: 0.5,
        height: 0.5,
        level: 1,
        labelSize: 2,
      },
      {
        id: "dir:tiny",
        x: 90,
        z: 40,
        width: 0.01,
        depth: 0.01,
        baseY: 0.5,
        height: 0.5,
        level: 1,
        labelSize: 1,
      },
    ],
    buildings,
    durationMs: 1,
  };
}

function expectInsideBox(thumbnail: OgThumbnail) {
  for (const rect of [...thumbnail.districts, ...thumbnail.buildings]) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(thumbnail.width + 0.11);
    expect(rect.y + rect.height).toBeLessThanOrEqual(thumbnail.height + 0.11);
  }
}

describe("projectCityMap", () => {
  it("projects every building into the box, preserving aspect ratio and centring", () => {
    const thumbnail = projectCityMap(layoutFixture(200), () => "#3b8eea", BOX);
    expect(thumbnail.kind).toBe("city");
    expect(thumbnail.buildings).toHaveLength(200);
    expect(thumbnail.totalBuildings).toBe(200);
    expectInsideBox(thumbnail);
    const root = thumbnail.districts[0];
    // The 204 x 104 world is width-bound: it spans the inner width and is vertically centred.
    expect(root?.width).toBeCloseTo(536, 0);
    expect(root?.x).toBeCloseTo(12, 0);
    expect((root?.y ?? 0) + (root?.height ?? 0) / 2).toBeCloseTo(230, 0);
  });

  it("drops sub-pixel districts and draws parents before children", () => {
    const thumbnail = projectCityMap(layoutFixture(10), () => "#fff", BOX);
    expect(thumbnail.districts.map((district) => district.level)).toEqual([0, 1]);
  });

  it("caps the number of buildings, keeping the most prominent ones", () => {
    const thumbnail = projectCityMap(layoutFixture(3_000), () => "#fff", {
      ...BOX,
      maxBuildings: 1_500,
    });
    expect(thumbnail.buildings).toHaveLength(1_500);
    expect(thumbnail.totalBuildings).toBe(3_000);
    // Tallest buildings (height 17 → opacity 1) survive the cap.
    expect(thumbnail.buildings.some((building) => building.opacity === 1)).toBe(true);
  });

  it("colors buildings through the provided callback and is deterministic", () => {
    const layout = layoutFixture(50);
    const colorFor = (id: string) => (id.endsWith("0.ts") ? "#ff0000" : "#00ff00");
    const first = projectCityMap(layout, colorFor, BOX);
    expect(projectCityMap(layout, colorFor, BOX)).toEqual(first);
    expect(first.buildings.filter((building) => building.color === "#ff0000")).toHaveLength(5);
  });

  it("handles a degenerate single-point world", () => {
    const layout = layoutFixture(1);
    const thumbnail = projectCityMap(
      { ...layout, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 1, size: 0 } },
      () => "#fff",
      BOX,
    );
    expectInsideBox(thumbnail);
    expect(
      thumbnail.buildings.every(
        (building) => Number.isFinite(building.x) && Number.isFinite(building.y),
      ),
    ).toBe(true);
  });
});

describe("generateAbstractMap", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = generateAbstractMap("facebook/react", "#f1e05a", BOX);
    expect(generateAbstractMap("facebook/react", "#f1e05a", BOX)).toEqual(a);
    expect(generateAbstractMap("vercel/next.js", "#f1e05a", BOX)).not.toEqual(a);
    expect(a.kind).toBe("abstract");
  });

  it("stays inside the box and respects the building cap", () => {
    for (const seed of ["a/b", "torvalds/linux", "x/y-z", "nodejs/node"]) {
      const thumbnail = generateAbstractMap(seed, "#3b8eea", { ...BOX, maxBuildings: 300 });
      expectInsideBox(thumbnail);
      expect(thumbnail.buildings.length).toBeLessThanOrEqual(300);
      expect(thumbnail.buildings.length).toBeGreaterThan(20);
    }
  });
});

describe("thumbnailToSvg", () => {
  it("serializes every district and building as a rect", () => {
    const thumbnail = projectCityMap(layoutFixture(25), () => "#3b8eea", BOX);
    const svg = thumbnailToSvg(thumbnail);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="460"')).toBe(
      true,
    );
    // Background grid + districts + buildings.
    expect(svg.match(/<rect /g)).toHaveLength(
      1 + thumbnail.districts.length + thumbnail.buildings.length,
    );
    expect(svg).toContain('fill="#3b8eea"');
  });

  it("only lets hex colors and numbers into the markup", () => {
    const svg = thumbnailToSvg({
      kind: "city",
      width: 100,
      height: 100,
      districts: [{ x: Number.NaN, y: 0, width: 10, height: 10, level: 99 }],
      buildings: [
        {
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          color: '"/><script>alert(1)</script><rect fill="',
          opacity: 5,
        },
        { x: 1, y: 1, width: 2, height: 2, color: "#ABCDEF", opacity: -1 },
      ],
      totalBuildings: 2,
    });
    expect(svg).not.toContain("<script");
    expect(svg).toContain('fill="#4de2ff" fill-opacity="1"');
    expect(svg).toContain('fill="#ABCDEF" fill-opacity="0"');
    expect(svg).toContain('x="0"');
  });

  it("encodes as a base64 data URI", () => {
    const uri = svgDataUri("<svg/>");
    expect(uri).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
  });
});

describe("color and randomness helpers", () => {
  it("hashes strings stably", () => {
    expect(hashString("react")).toBe(hashString("react"));
    expect(hashString("react")).not.toBe(hashString("reacT"));
  });

  it("produces values in [0, 1)", () => {
    const random = seededRandom(7);
    for (let i = 0; i < 1_000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("shades hex colors toward white or black and ignores invalid input", () => {
    expect(shadeColor("#000000", 1)).toBe("#ffffff");
    expect(shadeColor("#ffffff", -1)).toBe("#000000");
    expect(shadeColor("#808080", 0)).toBe("#808080");
    expect(shadeColor("red", 0.5)).toBe("red");
  });
});
