import { PerspectiveCamera, Vector3 } from "three";
import { computeWorldLayout } from "@/engine/layout/compute-layout";
import { buildLayoutLookup } from "@/engine/layout/lookup";
import { SYMBOL_LABEL_BUDGET } from "@/engine/lod/symbols";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { fileId } from "@/graph/model/ids";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { LabelCamera } from "./district-label-views";
import { BandCache } from "./symbol-band-data";
import {
  SYMBOL_LABEL_GAP_PX,
  SYMBOL_LABEL_PX,
  SYMBOL_LABEL_SPACING_PX,
  pickSymbolLabels,
  selectedSymbolLabelRects,
  symbolLabelFacadeOffset,
  symbolLabelRects,
} from "./symbol-label-views";

const WIDTH = 1440;
const HEIGHT = 900;

const index = buildGraphIndex(mockRepositoryGraph);
const layout = computeWorldLayout(mockRepositoryGraph);
const lookup = buildLayoutLookup(layout);
const entries = new BandCache(index, lookup).entriesFor(fileId("src/auth/auth.ts"));
const building = entries[0]?.building;
if (!building) throw new Error("expected symbol bands on src/auth/auth.ts");
const middle: [number, number, number] = [
  building.x,
  building.baseY + building.height / 2,
  building.z,
];

/** A real perspective camera (what snapshotCamera provides in the app), plus its right axis. */
function perspective(position: [number, number, number], target: [number, number, number]) {
  const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 5_000);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const forward = camera.getWorldDirection(new Vector3());
  const label: LabelCamera = {
    position: { x: position[0], y: position[1], z: position[2] },
    fovY: 45,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    project: (x, y, z) => {
      const p = new Vector3(x, y, z).project(camera);
      if (p.z < -1 || p.z > 1) return null;
      return { x: ((p.x + 1) / 2) * WIDTH, y: ((1 - p.y) / 2) * HEIGHT };
    },
    depth: (x, y, z) => new Vector3(x, y, z).sub(camera.position).dot(forward),
  };
  return { label, right: new Vector3(1, 0, 0).applyQuaternion(camera.quaternion) };
}

/** Orbits the building's middle at `distance`, seen from `azimuth` (rad) and ~52° from above. */
function orbit(distance: number, azimuth: number) {
  const polar = 0.9;
  return perspective(
    [
      middle[0] + distance * Math.sin(polar) * Math.sin(azimuth),
      middle[1] + distance * Math.cos(polar),
      middle[2] + distance * Math.sin(polar) * Math.cos(azimuth),
    ],
    middle,
  );
}

const near = orbit(10, 0.8);

describe("pickSymbolLabels", () => {
  it("labels bands spaced at least a line apart on screen", () => {
    const ids = pickSymbolLabels(entries, near.label, null);
    expect(ids.size).toBeGreaterThan(1);
    expect(ids.size).toBeLessThanOrEqual(SYMBOL_LABEL_BUDGET);
    const centres = entries
      .filter((entry) => ids.has(entry.band.id))
      .map((entry) => near.label.project(middle[0], (entry.band.y0 + entry.band.y1) / 2, middle[2]))
      .map((screen) => screen?.y ?? Number.NaN)
      .sort((a, b) => a - b);
    for (let i = 1; i < centres.length; i += 1) {
      expect((centres[i] ?? 0) - (centres[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        SYMBOL_LABEL_SPACING_PX - 1e-6,
      );
    }
  });

  it("always labels the selected symbol, and fewer bands from far away", () => {
    for (const entry of entries) {
      expect(pickSymbolLabels(entries, near.label, entry.band.id).has(entry.band.id)).toBe(true);
    }
    const far = pickSymbolLabels(entries, orbit(400, 0.8).label, null);
    expect(far.size).toBeGreaterThan(0);
    expect(far.size).toBeLessThan(pickSymbolLabels(entries, near.label, null).size);
    expect(pickSymbolLabels([], near.label, null).size).toBe(0);
  });
});

describe("symbolLabelRects", () => {
  it("places each label right of the facade, vertically centred on its band", () => {
    const ids = pickSymbolLabels(entries, near.label, null);
    const labelled = entries.filter((entry) => ids.has(entry.band.id));
    const rects = symbolLabelRects(entries, ids, near.label);
    expect(rects).toHaveLength(labelled.length);
    const offset = symbolLabelFacadeOffset(building);
    labelled.forEach((entry, i) => {
      const rect = rects[i];
      if (!rect) throw new Error("missing rect");
      // Where the billboard's text group starts: the band's middle pushed along the camera's right axis.
      const y = (entry.band.y0 + entry.band.y1) / 2;
      const start = new Vector3(...middle).setY(y).addScaledVector(near.right, offset);
      const screen = near.label.project(start.x, start.y, start.z);
      if (!screen) throw new Error("expected the facade on screen");
      // The text starts a gap further right; the rectangle adds its thin outline halo.
      const textStart = screen.x + SYMBOL_LABEL_GAP_PX;
      expect(rect.minX).toBeLessThanOrEqual(textStart);
      expect(rect.minX).toBeGreaterThan(textStart - 2);
      expect((rect.minY + rect.maxY) / 2).toBeCloseTo(screen.y, 4);
      expect(rect.maxY - rect.minY).toBeGreaterThanOrEqual(SYMBOL_LABEL_PX);
      expect(rect.maxX).toBeGreaterThan(rect.minX + SYMBOL_LABEL_PX);
    });
  });

  it("sizes labels by their names", () => {
    const all = new Set(entries.map((entry) => entry.band.id));
    const rects = symbolLabelRects(entries, all, near.label);
    const widthOf = (name: string) => {
      const i = entries.findIndex((entry) => entry.symbol.name === name);
      const rect = rects[i];
      return rect ? rect.maxX - rect.minX : Number.NaN;
    };
    expect(widthOf("verifyPassword")).toBeGreaterThan(widthOf("refresh"));
    expect(widthOf("revoke")).toBeLessThan(widthOf("refresh"));
  });

  it("leaves out unlabelled bands and labels behind the camera", () => {
    expect(symbolLabelRects(entries, new Set(), near.label)).toEqual([]);
    const all = new Set(entries.map((entry) => entry.band.id));
    // Standing in front of the building, looking away from it.
    const away = perspective(
      [middle[0], middle[1] + 5, middle[2] + 20],
      [middle[0], middle[1] + 5, middle[2] + 40],
    );
    expect(symbolLabelRects(entries, all, away.label)).toEqual([]);
  });

  it("measures exactly the labels the building shows", () => {
    const selected = entries[2]?.band.id ?? null;
    expect(selectedSymbolLabelRects(entries, near.label, selected)).toEqual(
      symbolLabelRects(entries, pickSymbolLabels(entries, near.label, selected), near.label),
    );
  });
});
