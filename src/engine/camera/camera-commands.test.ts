import { computeWorldLayout } from "@/engine/layout/compute-layout";
import { buildLayoutLookup, worldFrame } from "@/engine/layout/lookup";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { directoryId, fileId } from "@/graph/model/ids";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { NodeRef } from "@/graph/model/types";
import type { CameraCommand, CameraPose } from "@/state/explorer-store";
import {
  MAX_FRAMED_NODES,
  createNodeFramer,
  nodeFrames,
  repositoryPose,
  resolveCameraCommand,
  type CommandContext,
} from "./camera-commands";
import {
  MIN_CAMERA_Y,
  enclosingSphere,
  overviewPose,
  overviewTarget,
  poseFromSpherical,
  sphericalOf,
  type FrameSphere,
} from "./poses";

const index = buildGraphIndex(mockRepositoryGraph);
const layout = computeWorldLayout(mockRepositoryGraph);
const lookup = buildLayoutLookup(layout);
const frame = createNodeFramer(layout, lookup, index);
const view = { fovY: 45, aspect: 1.6 };
const world = worldFrame(layout);
const current: CameraPose = poseFromSpherical(world.center, {
  distance: 400,
  polar: 0.9,
  azimuth: 2,
});

function context(patch: Partial<CommandContext> = {}): CommandContext {
  return { current, view, world, selection: null, frame, minDistance: 1, ...patch };
}

function resolve(command: CameraCommand, patch: Partial<CommandContext> = {}) {
  return resolveCameraCommand(command, context(patch));
}

describe("resolveCameraCommand", () => {
  it("resets to the canonical overview", () => {
    expect(resolve({ type: "reset" })?.pose).toEqual(overviewPose(world, view));
  });

  it("frames the whole repository while keeping the heading", () => {
    const pose = resolve({ type: "focus-repository" })?.pose;
    expect(pose?.target).toEqual(overviewTarget(world));
    expect(sphericalOf(pose ?? current).azimuth).toBeCloseTo(2, 9);
    expect(repositoryPose(world, null, view)).toEqual(overviewPose(world, view));
  });

  it("does nothing without a world", () => {
    expect(resolve({ type: "reset" }, { world: null })).toBeNull();
    expect(resolve({ type: "focus-repository" }, { world: null })).toBeNull();
  });

  it("flies to a file's building", () => {
    const building = lookup.buildingsById.get(fileId("src/auth/auth.ts"));
    const pose = resolve({
      type: "focus-node",
      ref: { kind: "file", id: fileId("src/auth/auth.ts") },
    })?.pose;
    expect(building && pose).toBeTruthy();
    if (!building || !pose) return;
    expect(pose.target[0]).toBeCloseTo(building.x, 6);
    expect(pose.target[2]).toBeCloseTo(building.z, 6);
    expect(sphericalOf(pose).distance).toBeLessThan(sphericalOf(current).distance);
  });

  it("focuses the selection, and ignores focus-selected without one", () => {
    expect(resolve({ type: "focus-selected" })).toBeNull();
    const selection = { kind: "directory" as const, id: directoryId("src/payments") };
    const district = lookup.districtsById.get(selection.id);
    const pose = resolve({ type: "focus-selected" }, { selection })?.pose;
    expect(district && pose).toBeTruthy();
    if (!district || !pose) return;
    expect(pose.target[0]).toBeCloseTo(district.x, 6);
    expect(pose.target[2]).toBeCloseTo(district.z, 6);
  });

  it("returns null for unknown nodes", () => {
    expect(resolve({ type: "focus-node", ref: { kind: "file", id: "file:nope.ts" } })).toBeNull();
  });

  describe("focus-node with related nodes", () => {
    const ref: NodeRef = { kind: "file", id: fileId("src/auth/auth.ts") };
    const imports: NodeRef[] = [
      "src/auth/jwt.ts",
      "src/users/user.ts",
      "src/lib/logger.ts",
      "src/auth/session.ts",
    ].map((path) => ({ kind: "file", id: fileId(path) }));

    it("frames the node together with every included node", () => {
      const pose = resolve({ type: "focus-node", ref, include: imports })?.pose;
      const alone = resolve({ type: "focus-node", ref })?.pose;
      expect(pose && alone).toBeTruthy();
      if (!pose || !alone) return;
      const merged = enclosingSphere(nodeFrames(ref, imports, frame));
      expect(merged).not.toBeNull();
      if (!merged) return;
      expect(pose.target).toEqual(merged.center);
      for (const node of [ref, ...imports]) {
        const part = frame(node);
        expect(part).not.toBeNull();
        if (!part) continue;
        const [x, y, z] = part.center;
        const offset = Math.hypot(x - merged.center[0], y - merged.center[1], z - merged.center[2]);
        expect(offset + part.radius).toBeLessThanOrEqual(merged.radius + 1e-9);
      }
      // The group is spread over several districts: the camera pulls back to see all of it.
      expect(sphericalOf(pose).distance).toBeGreaterThan(sphericalOf(alone).distance);
      // Same heading as a single-node flight.
      expect(sphericalOf(pose).azimuth).toBeCloseTo(sphericalOf(alone).azimuth, 9);
    });

    it("behaves like a plain focus when nothing related can be framed", () => {
      const alone = resolve({ type: "focus-node", ref });
      expect(resolve({ type: "focus-node", ref, include: [] })).toEqual(alone);
      expect(
        resolve({ type: "focus-node", ref, include: [{ kind: "file", id: "file:nope.ts" }] }),
      ).toEqual(alone);
    });

    it("still frames the related nodes when the node itself has no geometry", () => {
      const first = imports[0];
      expect(first).toBeDefined();
      if (!first) return;
      const pose = resolve({
        type: "focus-node",
        ref: { kind: "file", id: "file:nope.ts" },
        include: [first],
      })?.pose;
      expect(pose?.target).toEqual(frame(first)?.center);
      expect(
        resolve({
          type: "focus-node",
          ref: { kind: "file", id: "file:nope.ts" },
          include: [{ kind: "file", id: "file:gone.ts" }],
        }),
      ).toBeNull();
    });
  });

  it("moves the target to a ground point, keeping the angle", () => {
    const pose = resolve({ type: "focus-point", x: 10, z: -20 })?.pose;
    expect(pose?.target).toEqual([10, 0, -20]);
    expect(sphericalOf(pose ?? current).distance).toBeCloseTo(sphericalOf(current).distance, 6);
    expect(resolve({ type: "focus-point", x: Number.NaN, z: 0 })).toBeNull();
  });

  it("validates share-link poses and honours the animate flag", () => {
    const pose: CameraPose = { position: [1, -5, 2], target: [0, 0, 0] };
    const resolved = resolve({ type: "set-pose", pose, animate: false });
    expect(resolved?.animate).toBe(false);
    expect(resolved?.pose.position[1]).toBe(MIN_CAMERA_Y);
    expect(
      resolve({
        type: "set-pose",
        pose: { position: [0, 0, 0], target: [0, 0, 0] },
        animate: true,
      }),
    ).toBeNull();
  });
});

describe("nodeFrames", () => {
  /** Unit spheres along the x axis, at the node's numeric id. */
  const along = (node: NodeRef): FrameSphere | null => {
    const x = Number(node.id);
    return Number.isFinite(x) ? { center: [x, 0, 0], radius: 1 } : null;
  };
  const refs = (count: number): NodeRef[] =>
    Array.from({ length: count }, (_, i) => ({ kind: "file", id: String(i + 1) }));

  it("frames the node first, then every related node, skipping those without geometry", () => {
    const frames = nodeFrames(
      { kind: "file", id: "0" },
      [...refs(3), { kind: "file", id: "x" }],
      along,
    );
    expect(frames.map((f) => f.center[0])).toEqual([0, 1, 2, 3]);
  });

  it("caps huge fan-ins, sampling evenly across the whole list", () => {
    const framer = vi.fn(along);
    const frames = nodeFrames({ kind: "file", id: "0" }, refs(10_000), framer);
    expect(framer).toHaveBeenCalledTimes(MAX_FRAMED_NODES);
    expect(frames).toHaveLength(MAX_FRAMED_NODES);
    expect(frames[0]?.center[0]).toBe(0);
    const xs = frames.slice(1).map((f) => f.center[0]);
    expect(new Set(xs).size).toBe(xs.length);
    // The samples reach the end of the list, so the merged frame spans the whole fan-in.
    expect(Math.max(...xs)).toBeGreaterThan(9_900);
    expect(nodeFrames({ kind: "file", id: "0" }, refs(10_000), along)).toEqual(frames);
  });

  it("frames a whole fan-in within the cap", () => {
    const frames = nodeFrames({ kind: "file", id: "0" }, refs(MAX_FRAMED_NODES - 1), along);
    expect(frames).toHaveLength(MAX_FRAMED_NODES);
  });
});

describe("createNodeFramer", () => {
  it("frames symbols via their band and falls back to the district of unplaced nodes", () => {
    const symbol = mockRepositoryGraph.symbols.find((s) => s.name === "AuthService");
    expect(symbol).toBeDefined();
    if (!symbol) return;
    const symbolFrame = frame({ kind: "symbol", id: symbol.id });
    const buildingFrame = frame({ kind: "file", id: symbol.fileId });
    expect(symbolFrame).not.toBeNull();
    expect(buildingFrame).not.toBeNull();

    // A file missing from the layout (e.g. a stale layout) frames its directory's district instead.
    const graph = buildFixtureGraph({
      owner: "o",
      name: "r",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "lib/a.ts", lines: 10 },
        { path: "lib/b.ts", lines: 10 },
      ],
    });
    const fixtureIndex = buildGraphIndex(graph);
    const partialGraph = { ...graph, files: graph.files.filter((f) => f.path !== "lib/b.ts") };
    const partialLayout = computeWorldLayout(partialGraph);
    const framer = createNodeFramer(partialLayout, buildLayoutLookup(partialLayout), fixtureIndex);
    const fallback = framer({ kind: "file", id: fileId("lib/b.ts") });
    const district = buildLayoutLookup(partialLayout).districtsById.get(directoryId("lib"));
    expect(fallback).not.toBeNull();
    expect(district).toBeDefined();
    if (fallback && district) {
      expect(fallback.center[0]).toBeCloseTo(district.x, 6);
      expect(fallback.center[2]).toBeCloseTo(district.z, 6);
    }
  });
});
