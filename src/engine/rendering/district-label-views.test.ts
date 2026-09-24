import { PerspectiveCamera, Vector3 } from "three";
import { computeWorldLayout } from "@/engine/layout/compute-layout";
import { buildLayoutLookup } from "@/engine/layout/lookup";
import { DISTRICT_LABEL_BUDGET, labelPixelSize } from "@/engine/lod/district-labels";
import { distance3, projectedSizePx } from "@/engine/lod/projection";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  LABEL_MIN_PIXELS,
  SUBLINE_MIN_TEXT_PX,
  VIEWPORT_INSET_PX,
  computeDistrictLabelViews,
  labelViewsSignature,
  nearEdge,
  placeOnEdge,
  sublineScaleFor,
  type DistrictLabelInput,
  type LabelCamera,
  type LabelEdge,
} from "./district-label-views";

const WIDTH = 1440;
const HEIGHT = 900;

/** A real perspective camera as a LabelCamera (what snapshotCamera provides in the app). */
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
  return label;
}

const index = buildGraphIndex(mockRepositoryGraph);
const layout = computeWorldLayout(mockRepositoryGraph);
const lookup = buildLayoutLookup(layout);

function views(camera: LabelCamera, patch: Partial<DistrictLabelInput> = {}) {
  return computeDistrictLabelViews({
    layout,
    index,
    camera,
    focusedId: null,
    previous: new Set(),
    ...patch,
  });
}

function insideViewport(camera: LabelCamera, x: number, y: number, z: number): boolean {
  const screen = camera.project(x, y, z);
  return (
    screen !== null &&
    screen.x >= VIEWPORT_INSET_PX - 1e-6 &&
    screen.x <= WIDTH - VIEWPORT_INSET_PX + 1e-6 &&
    screen.y >= VIEWPORT_INSET_PX - 1e-6 &&
    screen.y <= HEIGHT - VIEWPORT_INSET_PX + 1e-6
  );
}

/** The usual 3/4 view over the mock city. */
const overview = perspective([55, 60, 55], [0, 0, 0]);

describe("district label placement", () => {
  it("moves a parent's name to its near edge when a sub-district is labelled", () => {
    const labelled = views(overview);
    const ids = new Set(labelled.map((view) => view.id));
    const parents = labelled.filter((view) =>
      (index.directoriesById.get(view.id)?.childDirectoryIds ?? []).some((child) =>
        [...ids].some((id) => id === child || index.ancestorsOf(id).includes(child)),
      ),
    );
    expect(parents.length).toBeGreaterThan(0);
    for (const view of parents) {
      const district = lookup.districtsById.get(view.id);
      if (!district) throw new Error(`missing district ${view.id}`);
      const edge = nearEdge(district, overview);
      expect(edge).not.toBeNull();
      if (!edge) continue;
      // The anchor lies on the near edge segment (not at the slab centre).
      const along = Math.hypot(view.x - edge.ax, view.z - edge.az);
      const rest = Math.hypot(edge.bx - view.x, edge.bz - view.z);
      expect(along + rest).toBeCloseTo(Math.hypot(edge.bx - edge.ax, edge.bz - edge.az), 6);
    }
  });

  it("keeps leaves (and parents without labelled sub-districts) at their centre", () => {
    const labelled = views(overview);
    const ids = new Set(labelled.map((view) => view.id));
    const leaves = labelled.filter(
      (view) =>
        !(index.directoriesById.get(view.id)?.childDirectoryIds ?? []).some((child) =>
          [...ids].some((id) => id === child || index.ancestorsOf(id).includes(child)),
        ),
    );
    expect(leaves.length).toBeGreaterThan(0);
    for (const view of leaves) {
      const district = lookup.districtsById.get(view.id);
      if (!view.slide && district && insideViewport(overview, district.x, view.y, district.z)) {
        expect([view.x, view.z]).toEqual([district.x, district.z]);
      }
    }
  });

  it("drops districts whose anchor is off-screen", () => {
    // Close over the south-west corner: most of the city is outside the view.
    const close = perspective([-30, 14, 40], [-20, 0, 20]);
    const labelled = views(close);
    expect(labelled.length).toBeGreaterThan(0);
    for (const view of labelled) {
      if (view.slide) continue;
      expect(insideViewport(close, view.x, view.y, view.z)).toBe(true);
    }
    const far = views(overview);
    expect(labelled.map((view) => view.id)).not.toEqual(far.map((view) => view.id));
  });

  it("filters off-screen districts before the budget is applied", () => {
    const graph = createSyntheticGraph({ fileCount: 3_000, seed: 3 });
    const bigLayout = computeWorldLayout(graph);
    const bigIndex = buildGraphIndex(graph);
    const camera = perspective([0, bigLayout.bounds.size * 0.6, 1], [0, 0, 0]);
    // Districts large enough on screen for a label (by size alone), deepest last.
    const qualifying = bigLayout.districts
      .filter((d) => d.level > 0)
      .filter((d) => {
        const top = { x: d.x, y: d.baseY + d.height, z: d.z };
        const size = projectedSizePx(
          Math.max(d.width, d.depth),
          distance3(top, camera.position),
          45,
          HEIGHT,
        );
        return size >= LABEL_MIN_PIXELS && size <= HEIGHT * 2.2;
      })
      .sort((a, b) => a.level - b.level);
    const onScreen = qualifying.filter((d) => insideViewport(camera, d.x, d.baseY + d.height, d.z));
    const lowest = onScreen[onScreen.length - 1];
    if (!lowest) throw new Error("expected qualifying districts on screen");
    // More than a budget's worth of districts outrank it by hierarchy alone.
    expect(qualifying.filter((d) => d.level < lowest.level).length).toBeGreaterThan(
      DISTRICT_LABEL_BUDGET,
    );
    // Only the lowest-priority district is on screen.
    const onlyOne: LabelCamera = {
      ...camera,
      project: (x, y, z) => {
        const inside =
          Math.abs(x - lowest.x) <= lowest.width / 2 + 1e-9 &&
          Math.abs(z - lowest.z) <= lowest.depth / 2 + 1e-9;
        return inside ? camera.project(x, y, z) : { x: -10_000, y: -10_000 };
      },
    };
    const labelled = computeDistrictLabelViews({
      layout: bigLayout,
      index: bigIndex,
      camera: onlyOne,
      focusedId: null,
      previous: new Set(),
    });
    expect(labelled.map((view) => view.id)).toContain(lowest.id);
  });

  it("keeps statistics sublines at a legible size", () => {
    for (const level of [1, 2, 3, 6]) {
      const pixelSize = labelPixelSize(level, false);
      expect(pixelSize * sublineScaleFor(pixelSize)).toBeGreaterThanOrEqual(
        SUBLINE_MIN_TEXT_PX - 1e-9,
      );
    }
    const focusedId = "dir:src/payments";
    const labelled = views(overview, { focusedId });
    const focused = labelled.find((view) => view.id === focusedId);
    expect(focused?.subline).toMatch(/FILES · /);
    for (const view of labelled.filter((v) => v.subline)) {
      expect(view.pixelSize * view.sublineScale).toBeGreaterThanOrEqual(SUBLINE_MIN_TEXT_PX - 1e-9);
    }
  });

  it("changes the signature when an anchor moves, not when a sliding anchor slides", () => {
    const [first] = views(overview);
    if (!first) throw new Error("expected a label");
    const moved = { ...first, x: first.x + 1, slide: null };
    expect(labelViewsSignature([moved])).not.toBe(labelViewsSignature([{ ...first, slide: null }]));
    const edge: LabelEdge = { ax: 0, az: 0, bx: 1, bz: 0, y: 1, halfWidth: 10, headroom: 20 };
    expect(labelViewsSignature([{ ...first, slide: edge }])).toBe(
      labelViewsSignature([{ ...first, x: first.x + 5, slide: edge }]),
    );
  });
});

describe("nearEdge", () => {
  const slab = { x: 0, z: 0, width: 10, depth: 10, baseY: 0, height: 1 };

  it("picks the top edge nearest the viewer", () => {
    // Viewer on +Z: the z = +5 edge is lowest on screen.
    const fromSouth = nearEdge(slab, perspective([0, 20, 30], [0, 0, 0]));
    expect(fromSouth?.az).toBe(5);
    expect(fromSouth?.bz).toBe(5);
    // Viewer on -X: the x = -5 edge.
    const fromWest = nearEdge(slab, perspective([-30, 20, 0.5], [0, 0, 0]));
    expect(fromWest?.ax).toBe(-5);
    expect(fromWest?.bx).toBe(-5);
    expect(fromWest?.y).toBe(1);
  });

  it("ignores edges behind the camera", () => {
    expect(nearEdge(slab, perspective([0, 20, 30], [0, 20, 60]))).toBeNull();
  });
});

describe("placeOnEdge", () => {
  const camera = perspective([0, 30, 40], [0, 0, 0]);
  const edge = (patch: Partial<LabelEdge> = {}): LabelEdge => ({
    ax: -10,
    az: 5,
    bx: 10,
    bz: 5,
    y: 0,
    halfWidth: 40,
    headroom: 30,
    ...patch,
  });

  it("uses the edge's midpoint when the label fits there", () => {
    const placed = placeOnEdge(edge(), camera);
    expect(placed).toMatchObject({ x: 0, z: 5, slid: false });
  });

  it("slides along the edge to stay on screen, with a matching screen point", () => {
    // A long edge whose midpoint is far off to the right.
    const placed = placeOnEdge(edge({ ax: -20, bx: 400 }), camera);
    expect(placed?.slid).toBe(true);
    if (!placed) return;
    const screen = camera.project(placed.x, placed.y, placed.z);
    expect(screen?.x).toBeCloseTo(placed.screen.x, 3);
    expect(screen?.y).toBeCloseTo(placed.screen.y, 3);
    expect(placed.screen.x).toBeLessThanOrEqual(WIDTH - VIEWPORT_INSET_PX - 40 + 1e-6);
    expect(placed.x).toBeGreaterThan(-20);
    expect(placed.x).toBeLessThan(400);
  });

  it("returns null when no part of the edge is on screen", () => {
    expect(placeOnEdge(edge({ ax: 900, bx: 1_000 }), camera)).toBeNull();
    expect(placeOnEdge(edge({ az: 200, bz: 200 }), camera)).toBeNull();
  });

  it("lets a label overhang when the visible part of the edge is too short", () => {
    const placed = placeOnEdge(edge({ ax: -1, bx: 1, halfWidth: 2_000 }), camera);
    expect(placed).not.toBeNull();
  });
});
