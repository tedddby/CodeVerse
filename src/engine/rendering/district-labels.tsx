"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { LABEL_LETTER_SPACING_EM } from "@/engine/lod/district-labels";
import { useExplorerStore } from "@/state/explorer-store";
import { snapshotCamera } from "./camera-snapshot";
import {
  BASELINE_LIFT_PX,
  computeDistrictLabelViews,
  labelViewsSignature,
  nameOffset,
  placeOnEdge,
  type DistrictLabelView,
} from "./district-label-views";
import { LABEL_FONT_URL } from "./label-font";
import { createOverlayLabelMaterial } from "./materials/label-materials";
import { SCENE_HEX } from "./palette";
import { reportLayerCount } from "./render-stats";
import { applyScreenScale } from "./screen-size";
import { selectedSymbolLabelRects } from "./symbol-label-views";
import { useThrottledFrame } from "./use-throttled-frame";
import { refFileId, useWorld } from "./world-context";

/**
 * District labels as map annotations: uppercase, letter-spaced names that
 * stand on each district's slab (at its centre, or along its near edge when
 * sub-districts are labelled, see district-label-views), always face the
 * viewer, keep a constant on-screen size (larger for top-level districts) and
 * draw over the city with a dark halo that keeps them legible over bright
 * buildings. Which districts get a label is re-evaluated at most 4×/s
 * (projected size, hierarchy, budget ≤ 40, no on-screen overlaps), and none
 * may cover the selected file's symbol labels.
 */

const LABEL_HZ = 4;
const RENDER_ORDER = 20;

export function DistrictLabels() {
  const { layout, index, bands } = useWorld();
  const focusedId = useExplorerStore((state) => state.focusedDirectoryId);
  const hoveredId = useExplorerStore((state) =>
    state.hovered?.kind === "directory" ? state.hovered.id : null,
  );
  const selectedId = useExplorerStore((state) =>
    state.selection?.kind === "directory" ? state.selection.id : null,
  );
  const selectedFileId = useExplorerStore((state) => refFileId(state.selection, index));
  const selectedSymbolId = useExplorerStore((state) =>
    state.selection?.kind === "symbol" ? state.selection.id : null,
  );
  // The selected building's symbol bands: district labels keep clear of their labels.
  const symbolEntries = useMemo(
    () => (selectedFileId ? bands.entriesFor(selectedFileId) : []),
    [bands, selectedFileId],
  );
  const [views, setViews] = useState<DistrictLabelView[]>([]);
  const signatureRef = useRef("");

  const version = [layout.key, focusedId, selectedFileId, selectedSymbolId].join("|");
  useThrottledFrame(LABEL_HZ, version, (state) => {
    const camera = snapshotCamera(state);
    const next = computeDistrictLabelViews({
      layout,
      index,
      camera,
      focusedId,
      previous: new Set(views.map((view) => view.id)),
      isVisible: (candidate, radius) =>
        camera.sphereVisible(candidate.x, candidate.topY, candidate.z, radius),
      reserved: selectedSymbolLabelRects(symbolEntries, camera, selectedSymbolId),
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
                : view.id === hoveredId || view.id === focusedId
                  ? SCENE_HEX.signal
                  : view.inFocus
                    ? SCENE_HEX.ink
                    : SCENE_HEX.inkMuted
            }
          />
        ))}
      </group>
    </Suspense>
  );
}

/**
 * Shared text props; the overlay base material keeps labels on top, unlit and
 * unfogged. The opaque, slightly blurred outline is a halo in the void color:
 * it keeps names and statistics readable over bright language colors.
 */
const LABEL_TEXT_PROPS = {
  font: LABEL_FONT_URL,
  letterSpacing: LABEL_LETTER_SPACING_EM,
  anchorX: "center",
  anchorY: "bottom",
  whiteSpace: "nowrap",
  outlineWidth: "16%",
  outlineBlur: "6%",
  outlineColor: SCENE_HEX.void,
  renderOrder: RENDER_ORDER,
} as const;

function DistrictLabel({ view, color }: { view: DistrictLabelView; color: string }) {
  const anchorRef = useRef<Group>(null);
  const scaleRef = useRef<Group>(null);
  // One base material per label: troika keeps derived materials alive until their base is disposed.
  const material = useMemo(() => createOverlayLabelMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  const opacity = view.inFocus ? 0.95 : 0.45;

  useFrame((state) => {
    const anchor = anchorRef.current;
    const group = scaleRef.current;
    if (!anchor || !group) return;
    // Labels slid along their slab's near edge follow the camera smoothly.
    if (view.slide) {
      const placed = placeOnEdge(view.slide, snapshotCamera(state));
      if (placed) anchor.position.set(placed.x, placed.y, placed.z);
    }
    // Constant on-screen size: world units per pixel at the anchor's depth.
    const perPixel = applyScreenScale(
      group,
      state.camera,
      state.size.height,
      anchor.position,
      view.pixelSize,
    );
    group.position.y = BASELINE_LIFT_PX * perPixel;
  });

  return (
    <Billboard ref={anchorRef} position={[view.x, view.y, view.z]}>
      <group ref={scaleRef}>
        <Text
          {...LABEL_TEXT_PROPS}
          material={material}
          position={[0, nameOffset(view), 0]}
          fontSize={1}
          color={color}
          fillOpacity={opacity}
          outlineOpacity={opacity}
        >
          {view.text}
        </Text>
        {view.subline ? (
          <Text
            {...LABEL_TEXT_PROPS}
            material={material}
            fontSize={view.sublineScale}
            color={SCENE_HEX.inkMuted}
            fillOpacity={opacity}
            outlineOpacity={opacity}
          >
            {view.subline}
          </Text>
        ) : null}
      </group>
    </Billboard>
  );
}
