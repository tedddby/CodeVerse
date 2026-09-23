import { describe, expect, it } from "vitest";
import { byDepth, desaturateHex, isoBounds, isoFaces, projectIso, shadeHex } from "./iso";

function parsePoints(points: string): Array<[number, number]> {
  return points.split(" ").map((pair) => pair.split(",").map(Number) as [number, number]);
}

describe("projectIso", () => {
  it("draws nearer points (larger x + z) lower on screen and height upwards", () => {
    const origin = projectIso(0, 0, 0);
    expect(projectIso(1, 0, 1).y).toBeGreaterThan(origin.y);
    expect(projectIso(0, 1, 0).y).toBeLessThan(origin.y);
    // +X goes right, +Z goes left.
    expect(projectIso(1, 0, 0).x).toBeGreaterThan(0);
    expect(projectIso(0, 0, 1).x).toBeLessThan(0);
  });

  it("scales linearly", () => {
    const unit = projectIso(1, 2, 3);
    const scaled = projectIso(1, 2, 3, 10);
    expect(scaled.x).toBeCloseTo(unit.x * 10);
    expect(scaled.y).toBeCloseTo(unit.y * 10);
  });
});

describe("isoFaces", () => {
  it("returns three quadrilaterals, with the top face above the side faces", () => {
    const faces = isoFaces({ x: 0, z: 0, width: 2, depth: 2, height: 3 }, 10);
    const top = parsePoints(faces.top);
    const left = parsePoints(faces.left);
    const right = parsePoints(faces.right);
    for (const face of [top, left, right]) expect(face).toHaveLength(4);
    const lowestTop = Math.max(...top.map(([, y]) => y));
    const lowestSide = Math.max(...left.map(([, y]) => y), ...right.map(([, y]) => y));
    expect(lowestTop).toBeLessThan(lowestSide);
    // The left face sits left of the right face.
    const meanX = (face: Array<[number, number]>) =>
      face.reduce((sum, [x]) => sum + x, 0) / face.length;
    expect(meanX(left)).toBeLessThan(meanX(right));
  });

  it("honours baseY", () => {
    const grounded = parsePoints(isoFaces({ x: 0, z: 0, width: 1, depth: 1, height: 1 }).top);
    const raised = parsePoints(
      isoFaces({ x: 0, z: 0, width: 1, depth: 1, height: 1, baseY: 2 }).top,
    );
    grounded.forEach(([x, y], index) => {
      expect(raised[index]?.[0]).toBeCloseTo(x);
      expect(raised[index]?.[1]).toBeCloseTo(y - 2);
    });
  });
});

describe("isoBounds", () => {
  it("contains every projected corner", () => {
    const boxes = [
      { x: -3, z: 1, width: 1, depth: 2, height: 4 },
      { x: 2, z: -2, width: 3, depth: 1, height: 1, baseY: 1 },
    ];
    const bounds = isoBounds(boxes, 5);
    for (const box of boxes) {
      const faces = isoFaces(box, 5);
      for (const [x, y] of [faces.top, faces.left, faces.right].flatMap(parsePoints)) {
        expect(x).toBeGreaterThanOrEqual(bounds.minX - 0.01);
        expect(x).toBeLessThanOrEqual(bounds.maxX + 0.01);
        expect(y).toBeGreaterThanOrEqual(bounds.minY - 0.01);
        expect(y).toBeLessThanOrEqual(bounds.maxY + 0.01);
      }
    }
  });

  it("is empty-safe", () => {
    expect(isoBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("byDepth", () => {
  it("orders far boxes before near ones", () => {
    const far = { x: -1, z: -1, width: 1, depth: 1, height: 1 };
    const near = { x: 1, z: 1, width: 1, depth: 1, height: 1 };
    expect([near, far].sort(byDepth)).toEqual([far, near]);
  });
});

describe("color helpers", () => {
  it("shades channels multiplicatively and clamps", () => {
    expect(shadeHex("#808080", 0.5)).toBe("#404040");
    expect(shadeHex("#ffffff", 2)).toBe("#ffffff");
    expect(shadeHex("#4de2ff", 1)).toBe("#4de2ff");
  });

  it("desaturates towards luminance gray", () => {
    expect(desaturateHex("#4de2ff", 0)).toBe("#4de2ff");
    const gray = desaturateHex("#ff0000", 1);
    expect(gray.slice(1, 3)).toBe(gray.slice(3, 5));
    expect(gray.slice(3, 5)).toBe(gray.slice(5, 7));
  });

  it("returns malformed input unchanged", () => {
    expect(shadeHex("red", 0.5)).toBe("red");
    expect(desaturateHex("#abc", 0.5)).toBe("#abc");
  });
});
