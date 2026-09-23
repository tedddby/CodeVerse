"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { worldFrame } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";
import { getLayoutLookup } from "@/engine/rendering/layout-lookup-cache";
import { isTypingTarget } from "@/lib/shortcuts";
import {
  selectHasBlockingOverlay,
  useExplorerStore,
  type CameraCommand,
  type CameraPose,
  type ExplorerState,
} from "@/state/explorer-store";
import { createNodeFramer, resolveCameraCommand } from "./camera-commands";
import { CameraController, EMPTY_WORLD, type WorldInfo } from "./camera-controller";
import { overviewPose, posesEqual, roundPose } from "./poses";

/**
 * Owns the camera: orbit/explore navigation, store camera commands, the
 * establishing shot for each new repository, preview auto-rotation and
 * throttled pose reporting (share links, minimap). Rendered inside the Canvas.
 */
export interface CameraRigProps {
  /** false = preview: no pointer/keyboard input, no pose reporting. */
  interactive: boolean;
  /** Slow orbit around the world centre (previews); paused while the user interacts. */
  autoRotate?: boolean;
}

/** Pose reports to the store at most 4×/s, and only when the pose changed. */
const POSE_REPORT_INTERVAL = 0.25;

function worldInfo(layout: WorldLayout): WorldInfo {
  const { minX, maxX, minZ, maxZ, maxY, size } = layout.bounds;
  return {
    frame: worldFrame(layout),
    size: Math.max(1, size),
    bounds: { minX, maxX, minZ, maxZ, maxY },
  };
}

/** Movement keys drive the camera only outside text fields and modal overlays. */
function acceptMovementKey(event: KeyboardEvent): boolean {
  const state = useExplorerStore.getState();
  return (
    state.navigationMode === "explore" &&
    !isTypingTarget(event.target) &&
    !selectHasBlockingOverlay(state)
  );
}

function executeCommand(
  controller: CameraController,
  command: CameraCommand,
  state: ExplorerState,
): void {
  const { layout, index } = state;
  const world = controller.getWorld();
  const resolved = resolveCameraCommand(command, {
    current: controller.currentPose(),
    view: controller.viewSpec(),
    world: layout ? world.frame : null,
    selection: state.selection,
    frame: layout && index ? createNodeFramer(layout, getLayoutLookup(layout), index) : () => null,
    minDistance: controller.getMinDistance(),
  });
  if (resolved) controller.flyTo(resolved.pose, resolved.animate);
}

/**
 * Bridges store changes to the controller in one deterministic place:
 * first world changes (and the intro for a new repository), then commands.
 * Commands wait for a layout, so a share link's pose issued while the
 * repository is still loading replaces the intro instead of being overridden by it.
 */
function createStoreSync(controller: CameraController) {
  let lastLayout: WorldLayout | null | undefined;
  let introKey: string | null = null;
  let handledNonce = 0;

  return (state: ExplorerState) => {
    const pending =
      state.cameraCommand && state.cameraCommand.nonce > handledNonce ? state.cameraCommand : null;

    if (state.layout !== lastLayout) {
      lastLayout = state.layout;
      controller.setWorld(state.layout ? worldInfo(state.layout) : null);
      if (!state.layout) {
        if (introKey === null)
          controller.jumpTo(overviewPose(EMPTY_WORLD.frame, controller.viewSpec()));
      } else if (state.layout.key !== introKey) {
        introKey = state.layout.key;
        // A pending command (share link pose, deep-linked selection) defines the first view.
        if (!pending) controller.playIntro();
      }
    }

    if (pending && state.layout) {
      handledNonce = pending.nonce;
      executeCommand(controller, pending, state);
    }
  };
}

export function CameraRig({ interactive, autoRotate = false }: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const eventSource = useThree((state) => state.events.connected as HTMLElement | null | undefined);
  const navigationMode = useExplorerStore((state) => state.navigationMode);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const inputElement = eventSource ?? canvas;

  const controller = useMemo(() => new CameraController(camera, acceptMovementKey), [camera]);
  useEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);

  useEffect(() => {
    controller.setOptions({ autoRotate, reducedMotion });
  }, [controller, autoRotate, reducedMotion]);

  useEffect(() => {
    if (!interactive) return;
    controller.attach(inputElement);
    return () => controller.detach();
  }, [controller, interactive, inputElement]);

  useEffect(() => {
    controller.setMode(interactive ? navigationMode : "orbit");
  }, [controller, interactive, navigationMode]);

  useEffect(() => {
    const sync = createStoreSync(controller);
    sync(useExplorerStore.getState());
    return useExplorerStore.subscribe(sync);
  }, [controller]);

  const sinceReportRef = useRef(0);
  const lastReportRef = useRef<CameraPose | null>(null);

  useFrame((_, delta) => {
    controller.update(delta);
    if (!interactive) return;
    sinceReportRef.current += delta;
    if (sinceReportRef.current < POSE_REPORT_INTERVAL) return;
    sinceReportRef.current = 0;
    const pose = roundPose(controller.currentPose());
    if (posesEqual(pose, lastReportRef.current, 5e-3)) return;
    lastReportRef.current = pose;
    useExplorerStore.getState().setCameraPose(pose);
  });

  return null;
}
