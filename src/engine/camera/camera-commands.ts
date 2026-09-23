import { frameTarget, type LayoutLookup } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import type { CameraCommand, CameraPose } from "@/state/explorer-store";
import {
  OVERVIEW_PADDING,
  OVERVIEW_POLAR,
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
      const frame = context.frame(command.ref);
      return frame
        ? { pose: framePose(frame, current, view, context.minDistance), animate: true }
        : null;
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
