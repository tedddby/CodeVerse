"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { selectSymbolLabels } from "@/engine/lod/symbols";
import { LABEL_FONT_URL } from "./label-font";
import { createSceneLabelMaterial } from "./materials/label-materials";
import { SCENE_HEX } from "./palette";
import { reportLayerCount } from "./render-stats";
import { applyScreenScale, worldUnitsPerPixel } from "./screen-size";
import { bandProtrusion, symbolKindHex } from "./symbol-band-geometry";
import { symbolLabelText, type BandEntry } from "./symbol-band-data";
import { useThrottledFrame } from "./use-throttled-frame";

/**
 * Labels for the selected building's symbol bands, beside the facade on the
 * viewer's right. Constant on-screen size; which bands get a label (≤ 25,
 * largest first, never stacked closer than a line of text on screen) is
 * re-evaluated at most 4×/s as the camera zooms.
 */

const LABEL_HZ = 4;
const LABEL_PX = 11.5;
/** Minimum vertical distance between label centres on screen (px). */
const LABEL_SPACING_PX = 16;
/** Gap between the facade and the label (px). */
const LABEL_GAP_PX = 6;

export function SymbolLabels({
  entries,
  selectedSymbolId,
}: {
  entries: BandEntry[];
  selectedSymbolId: string | null;
}) {
  const building = entries[0]?.building ?? null;
  const [labelIds, setLabelIds] = useState<ReadonlySet<string>>(() => new Set());
  const signatureRef = useRef("");

  useThrottledFrame(
    LABEL_HZ,
    `${building?.id ?? ""}|${selectedSymbolId ?? ""}|${entries.length}`,
    ({ camera, size }) => {
      if (!building) return;
      const perPixel = worldUnitsPerPixel(
        camera,
        size.height,
        building.x,
        building.baseY + building.height / 2,
        building.z,
      );
      const spans = entries.map((entry) => ({
        id: entry.band.id,
        y0: entry.band.y0,
        y1: entry.band.y1,
      }));
      const ids = new Set(
        selectSymbolLabels(spans, LABEL_SPACING_PX * perPixel).map((span) => span.id),
      );
      if (selectedSymbolId && entries.some((entry) => entry.band.id === selectedSymbolId))
        ids.add(selectedSymbolId);
      const signature = [...ids].sort().join("\n");
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setLabelIds(ids);
    },
  );

  const visible = useMemo(
    () => entries.filter((entry) => labelIds.has(entry.band.id)),
    [entries, labelIds],
  );
  useEffect(() => {
    reportLayerCount("labels", "symbol-bands", visible.length);
    return () => reportLayerCount("labels", "symbol-bands", 0);
  }, [visible]);

  if (!building) return null;
  const facadeOffset = Math.hypot(building.width, building.depth) / 2 + bandProtrusion(building, 3);
  return (
    <Suspense fallback={null}>
      {visible.map((entry) => (
        <SymbolLabel
          key={entry.band.id}
          entry={entry}
          facadeOffset={facadeOffset}
          selected={entry.band.id === selectedSymbolId}
        />
      ))}
    </Suspense>
  );
}

function SymbolLabel({
  entry,
  facadeOffset,
  selected,
}: {
  entry: BandEntry;
  facadeOffset: number;
  selected: boolean;
}) {
  const scaleRef = useRef<Group>(null);
  // One base material per label: troika keeps derived materials alive until their base is disposed.
  const material = useMemo(() => createSceneLabelMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  const anchor = useMemo(
    () => ({ x: entry.building.x, y: (entry.band.y0 + entry.band.y1) / 2, z: entry.building.z }),
    [entry],
  );

  useFrame(({ camera, size }) => {
    const group = scaleRef.current;
    if (group) applyScreenScale(group, camera, size.height, anchor, LABEL_PX);
  });

  return (
    <Billboard position={[anchor.x, anchor.y, anchor.z]}>
      <group position={[facadeOffset, 0, 0]}>
        <group ref={scaleRef}>
          <Text
            font={LABEL_FONT_URL}
            material={material}
            position={[LABEL_GAP_PX / LABEL_PX, 0, 0]}
            fontSize={1}
            anchorX="left"
            anchorY="middle"
            color={selected ? SCENE_HEX.flare : symbolKindHex(entry.symbol.kind)}
            outlineWidth="8%"
            outlineColor={SCENE_HEX.void}
            outlineOpacity={0.85}
            whiteSpace="nowrap"
          >
            {symbolLabelText(entry.symbol.name)}
          </Text>
        </group>
      </group>
    </Billboard>
  );
}
