"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { snapshotCamera } from "./camera-snapshot";
import { LABEL_FONT_URL } from "./label-font";
import { createSceneLabelMaterial } from "./materials/label-materials";
import { SCENE_HEX } from "./palette";
import { reportLayerCount } from "./render-stats";
import { applyScreenScale } from "./screen-size";
import { symbolLabelText, type BandEntry } from "./symbol-band-data";
import { symbolKindHex } from "./symbol-band-geometry";
import {
  SYMBOL_LABEL_GAP_PX,
  SYMBOL_LABEL_PX,
  pickSymbolLabels,
  symbolLabelFacadeOffset,
} from "./symbol-label-views";
import { useThrottledFrame } from "./use-throttled-frame";

/**
 * Labels for the selected building's symbol bands, beside the facade on the
 * viewer's right. Constant on-screen size; which bands get a label (≤ 25,
 * largest first, never stacked closer than a line of text on screen, at any
 * pitch, see symbol-label-views) is re-evaluated at most 4×/s as the camera
 * moves.
 */

const LABEL_HZ = 4;

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
    (state) => {
      if (!building) return;
      const ids = pickSymbolLabels(entries, snapshotCamera(state), selectedSymbolId);
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
  const facadeOffset = symbolLabelFacadeOffset(building);
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
    if (group) applyScreenScale(group, camera, size.height, anchor, SYMBOL_LABEL_PX);
  });

  return (
    <Billboard position={[anchor.x, anchor.y, anchor.z]}>
      <group position={[facadeOffset, 0, 0]}>
        <group ref={scaleRef}>
          <Text
            font={LABEL_FONT_URL}
            material={material}
            position={[SYMBOL_LABEL_GAP_PX / SYMBOL_LABEL_PX, 0, 0]}
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
