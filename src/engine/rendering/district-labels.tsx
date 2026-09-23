"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Camera, Group } from "three";
import { LABEL_LETTER_SPACING_EM } from "@/engine/lod/district-labels";
import { useExplorerStore } from "@/state/explorer-store";
import { snapshotCamera } from "./camera-snapshot";
import {
  SUBLINE_SCALE,
  computeDistrictLabelViews,
  labelViewsSignature,
  nameOffset,
  type DistrictLabelView,
} from "./district-label-views";
import { LABEL_FONT_URL } from "./label-font";
import { createOverlayLabelMaterial } from "./materials/label-materials";
import { SCENE_HEX } from "./palette";
import { reportLayerCount } from "./render-stats";
import { applyScreenScale } from "./screen-size";
import { useThrottledFrame } from "./use-throttled-frame";
import { useWorld } from "./world-context";

/**
 * District labels as map annotations: uppercase, letter-spaced names that
 * stand above each district's slab, always face the viewer, keep a constant
 * on-screen size (larger for top-level districts) and draw over the city.
 * Which districts get a label is re-evaluated at most 4×/s (projected size,
 * hierarchy, budget ≤ 40, no on-screen overlaps).
 */

const LABEL_HZ = 4;
const RENDER_ORDER = 20;
/** Lift of the label's baseline above the slab (px), so it never touches the slab outline. */
const BASELINE_LIFT_PX = 6;

export function DistrictLabels() {
  const { layout, index } = useWorld();
  const focusedId = useExplorerStore((state) => state.focusedDirectoryId);
  const hoveredId = useExplorerStore((state) =>
    state.hovered?.kind === "directory" ? state.hovered.id : null,
  );
  const selectedId = useExplorerStore((state) =>
    state.selection?.kind === "directory" ? state.selection.id : null,
  );
  const [views, setViews] = useState<DistrictLabelView[]>([]);
  const signatureRef = useRef("");

  useThrottledFrame(LABEL_HZ, `${layout.key}|${focusedId ?? ""}`, (state) => {
    const camera = snapshotCamera(state);
    const next = computeDistrictLabelViews({
      layout,
      index,
      camera,
      focusedId,
      previous: new Set(views.map((view) => view.id)),
      isVisible: (candidate, radius) =>
        camera.sphereVisible(candidate.x, candidate.topY, candidate.z, radius),
    });
    const signature = labelViewsSignature(next);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setViews(next);
  });

  useEffect(() => {
    reportLayerCount("labels", "districts", views.length);
  }, [views]);
  useEffect(() => () => reportLayerCount("labels", "districts", 0), []);

  return (
    <Suspense fallback={null}>
      <group name="district-labels">
        {views.map((view) => (
          <DistrictLabel
            key={view.id}
            view={view}
            color={
              view.id === selectedId
                ? SCENE_HEX.flare
                : view.id === hoveredId
                  ? SCENE_HEX.ink
                  : view.id === focusedId
                    ? SCENE_HEX.signal
                    : SCENE_HEX.inkMuted
            }
          />
        ))}
      </group>
    </Suspense>
  );
}

/** Shared text props; the overlay base material keeps labels on top, unlit and unfogged. */
const LABEL_TEXT_PROPS = {
  font: LABEL_FONT_URL,
  letterSpacing: LABEL_LETTER_SPACING_EM,
  anchorX: "center",
  anchorY: "bottom",
  whiteSpace: "nowrap",
  outlineWidth: "6%",
  outlineColor: SCENE_HEX.void,
  outlineOpacity: 0.75,
  renderOrder: RENDER_ORDER,
} as const;

/** Scales a label group so one unit spans `view.pixelSize` screen pixels at the anchor. */
function applyScreenSize(
  group: Group,
  camera: Camera,
  viewportHeight: number,
  view: DistrictLabelView,
): void {
  const perPixel = applyScreenScale(group, camera, viewportHeight, view, view.pixelSize);
  group.position.y = BASELINE_LIFT_PX * perPixel;
}

function DistrictLabel({ view, color }: { view: DistrictLabelView; color: string }) {
  const scaleRef = useRef<Group>(null);
  // One base material per label: troika keeps derived materials alive until their base is disposed.
  const material = useMemo(() => createOverlayLabelMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  const opacity = view.inFocus ? 0.95 : 0.4;

  // Constant on-screen size: world units per pixel at the anchor's distance.
  useFrame(({ camera, size }) => {
    const group = scaleRef.current;
    if (group) applyScreenSize(group, camera, size.height, view);
  });

  return (
    <Billboard position={[view.x, view.y, view.z]}>
      <group ref={scaleRef}>
        <Text
          {...LABEL_TEXT_PROPS}
          material={material}
          position={[0, nameOffset(view.subline !== null), 0]}
          fontSize={1}
          color={color}
          fillOpacity={opacity}
        >
          {view.text}
        </Text>
        {view.subline ? (
          <Text
            {...LABEL_TEXT_PROPS}
            material={material}
            fontSize={SUBLINE_SCALE}
            color={SCENE_HEX.inkSubtle}
            fillOpacity={opacity}
          >
            {view.subline}
          </Text>
        ) : null}
      </group>
    </Billboard>
  );
}
