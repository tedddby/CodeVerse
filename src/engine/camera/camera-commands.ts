import { frameTarget, type LayoutLookup } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import type { CameraCommand, CameraPose } from "@/state/explorer-store";
import {
  FRAME_PADDING,
  OVERVIEW_PADDING,
  OVERVIEW_POLAR,
  enclosingSphere,
  fitDistance,
  focusPointPose,
  framePose,
  overviewPose,
  overviewTarget,
  poseFromSpherical,
  sanitizePose,
  sphericalOf,
  type FrameSphere,
  type ViewSpec,
} from "./poses";

/**
 * Resolves store camera commands into target poses. Pure: the current pose,
 * view and world framing are passed in, so every command is unit-testable.
 */

export interface CommandContext {
  current: CameraPose;
  view: ViewSpec;
  /** Whole-world frame (null before a layout exists). */
  world: FrameSphere | null;
  /** Current selection, for "focus-selected". */
  selection: NodeRef | null;
  /** Frames a node; null when it has no geometry. */
  frame: (ref: NodeRef) => FrameSphere | null;
  /** Closest the orbit camera may get. */
  minDistance: number;
}

export interface ResolvedCommand {
  pose: CameraPose;
  animate: boolean;
}

/** Most nodes framed together by one focus-node command (bounds huge fan-ins). */
export const MAX_FRAMED_NODES = 200;
/**
 * Fit padding when framing a node together with related ones: their
 * enclosing sphere already leaves room around them, and the usual padding
 * would pull a city-wide group out further than the overview.
 */
const GROUP_FRAME_PADDING = 1.1;

/**
 * Frames of `ref` and its related `include` nodes, `ref` first. At most
 * MAX_FRAMED_NODES are considered: beyond that the related nodes are sampled
 * evenly across the list (deterministically), so the frame still spans all of
 * it. Nodes without geometry are skipped.
 */
export function nodeFrames(
  ref: NodeRef,
  include: readonly NodeRef[],
  frame: (ref: NodeRef) => FrameSphere | null,
): FrameSphere[] {
  const slots = MAX_FRAMED_NODES - 1;
  const refs = [ref];
  if (include.length <= slots) {
    refs.push(...include);
  } else {
    for (let i = 0; i < slots; i += 1) {
      const sampled = include[Math.floor((i * include.length) / slots)];
      if (sampled) refs.push(sampled);
    }
  }
  const frames: FrameSphere[] = [];
  for (const node of refs) {
    const framed = frame(node);
    if (framed) frames.push(framed);
  }
  return frames;
}

/** Comfortable elevation band when re-framing the whole repository. */
const REPOSITORY_MIN_POLAR = 0.6;
const REPOSITORY_MAX_POLAR = 1.05;

export function repositoryPose(
  world: FrameSphere,
  current: CameraPose | null,
  view: ViewSpec,
): CameraPose {
  if (!current) return overviewPose(world, view);
  const spherical = sphericalOf(current);
  const polar =
    spherical.distance > 0
      ? Math.min(REPOSITORY_MAX_POLAR, Math.max(REPOSITORY_MIN_POLAR, spherical.polar))
      : OVERVIEW_POLAR;
  return poseFromSpherical(overviewTarget(world), {
    distance: fitDistance(world.radius, view, OVERVIEW_PADDING),
    polar,
    azimuth: spherical.azimuth,
  });
}

/**
 * Target pose for a command, or null when it does not apply (no selection,
 * unknown node, malformed share-link pose, no world yet).
 */
export function resolveCameraCommand(
  command: CameraCommand,
  context: CommandContext,
): ResolvedCommand | null {
  const { current, view, world } = context;
  switch (command.type) {
    case "reset":
      return world ? { pose: overviewPose(world, view), animate: true } : null;
    case "focus-repository":
      return world ? { pose: repositoryPose(world, current, view), animate: true } : null;
    case "focus-selected": {
      if (!context.selection) return null;
      const frame = context.frame(context.selection);
      return frame
        ? { pose: framePose(frame, current, view, context.minDistance), animate: true }
        : null;
    }
    case "focus-node": {
      if (!command.include?.length) {
        const frame = context.frame(command.ref);
        return frame
          ? { pose: framePose(frame, current, view, context.minDistance), animate: true }
          : null;
      }
      // The node together with its related nodes (e.g. a file and its imports).
      const frames = nodeFrames(command.ref, command.include, context.frame);
      const frame = enclosingSphere(frames);
      if (!frame) return null;
      const padding = frames.length > 1 ? GROUP_FRAME_PADDING : FRAME_PADDING;
      return {
        pose: framePose(frame, current, view, context.minDistance, padding),
        animate: true,
      };
    }
    case "focus-point":
      if (!Number.isFinite(command.x) || !Number.isFinite(command.z)) return null;
      return { pose: focusPointPose(current, command.x, command.z), animate: true };
    case "set-pose": {
      const pose = sanitizePose(command.pose);
      return pose ? { pose, animate: command.animate } : null;
    }
  }
}

function boxSphere(
  x: number,
  z: number,
  width: number,
  depth: number,
  bottom: number,
  top: number,
): FrameSphere {
  const half = Math.max(0, top - bottom) / 2;
  return {
    center: [x, bottom + half, z],
    radius: Math.max(1.5, Math.hypot(width / 2, depth / 2, half)),
  };
}

/**
 * Framing for a node: the layout engine's `frameTarget`, falling back to the
 * nearest geometry that does exist (a file's district, a directory's closest
 * laid-out ancestor) so "fly to" always goes somewhere sensible.
 */
export function createNodeFramer(
  layout: WorldLayout,
  lookup: LayoutLookup,
  index: GraphIndex,
): (ref: NodeRef) => FrameSphere | null {
  const districtFrame = (directoryId: string): FrameSphere | null => {
    const chain = index.ancestorsOf(directoryId);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const district = lookup.districtsById.get(chain[i] ?? "");
      if (district) {
        return boxSphere(
          district.x,
          district.z,
          district.width,
          district.depth,
          district.baseY,
          district.baseY + district.height,
        );
      }
    }
    return null;
  };
  return (ref) => {
    const exact = frameTarget(layout, lookup, ref, index);
    if (exact) return exact;
    switch (ref.kind) {
      case "directory":
        return districtFrame(ref.id);
      case "file": {
        const file = index.filesById.get(ref.id);
        return file ? districtFrame(file.directoryId) : null;
      }
      case "symbol": {
        const symbol = index.symbolsById.get(ref.id);
        const file = symbol ? index.filesById.get(symbol.fileId) : undefined;
        if (!file) return null;
        const building = lookup.buildingsById.get(file.id);
        return building
          ? boxSphere(
              building.x,
              building.z,
              building.width,
              building.depth,
              building.baseY,
              building.baseY + building.height,
            )
          : districtFrame(file.directoryId);
      }
    }
  };
}
