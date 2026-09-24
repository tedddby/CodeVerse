"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  type ShaderMaterial,
} from "three";
import { selectSymbolBuildings } from "@/engine/lod/symbols";
import type { GraphIndex } from "@/graph/model/graph-index";
import { useExplorerStore, type ExplorerState } from "@/state/explorer-store";
import { snapshotCamera } from "./camera-snapshot";
import { createInstancedBoxes, writeBoxMatrix } from "./instanced-boxes";
import { BAND_STATE, createBandMaterial } from "./materials/band-material";
import { hexToLinear } from "./palette";
import { isDragClick } from "./pointer";
import { reportLayerCount } from "./render-stats";
import { bandBox, symbolKindHex } from "./symbol-band-geometry";
import { bandPickRef, type BandEntry } from "./symbol-band-data";
import { SymbolLabels } from "./symbol-labels";
import { useThrottledFrame } from "./use-throttled-frame";
import { refFileId, useWorld, type WorldContextValue } from "./world-context";

/**
 * Symbol bands: when the camera is close (or a file is selected), classes,
 * functions, types... appear as translucent colored collars on the building
 * at their line ranges. Computed lazily for ≤ 30 buildings; the selected
 * building also gets up to 25 labels (see SymbolLabels). Only the selected
 * file's bands pick as symbols; bands on nearby buildings pick their file.
 */

const BAND_HZ = 4;
/** Hard cap on band instances regardless of how symbol-dense the nearby files are. */
const MAX_BANDS = 4_000;
/** Emphasis of bands on nearby, unselected buildings (the selected file gets 1). */
const NEARBY_BAND_EMPHASIS = 0.25;

interface BandRuntime {
  mesh: InstancedMesh;
  state: InstancedBufferAttribute;
  entries: BandEntry[];
}

function createBandRuntime(entries: BandEntry[], material: ShaderMaterial): BandRuntime | null {
  if (entries.length === 0) return null;
  const count = entries.length;
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const state = new InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(
    DynamicDrawUsage,
  );
  const mesh = createInstancedBoxes(count, material, { aColor: colors, aState: state });
  mesh.name = "symbol-bands";
  // Translucent collars draw after the opaque buildings they wrap.
  mesh.renderOrder = 2;
  const matrices = mesh.instanceMatrix.array as Float32Array;
  entries.forEach((entry, i) => {
    const box = bandBox(entry.building, entry.band);
    writeBoxMatrix(matrices, i, box.x, box.y, box.z, box.width, box.height, box.depth);
    const color = hexToLinear(symbolKindHex(entry.symbol.kind));
    colors.array[i * 3] = color[0];
    colors.array[i * 3 + 1] = color[1];
    colors.array[i * 3 + 2] = color[2];
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, state, entries };
}

function disposeBandRuntime(runtime: BandRuntime | null): void {
  if (!runtime) return;
  runtime.mesh.geometry.dispose();
  runtime.mesh.dispose();
}

function writeBandStates(runtime: BandRuntime, state: ExplorerState, index: GraphIndex): void {
  const hoveredId = state.hovered?.kind === "symbol" ? state.hovered.id : null;
  const selectedId = state.selection?.kind === "symbol" ? state.selection.id : null;
  const selectedFileId = refFileId(state.selection, index);
  const values = runtime.state.array;
  runtime.entries.forEach((entry, i) => {
    values[i * 2] = entry.symbol.fileId === selectedFileId ? 1 : NEARBY_BAND_EMPHASIS;
    values[i * 2 + 1] =
      (entry.symbol.id === hoveredId ? BAND_STATE.hovered : 0) |
      (entry.symbol.id === selectedId ? BAND_STATE.selected : 0);
  });
  runtime.state.needsUpdate = true;
}

export function SymbolBands() {
  const world = useWorld();
  const { layout, index, bands } = world;
  const selection = useExplorerStore((state) => state.selection);
  const focusedId = useExplorerStore((state) => state.focusedDirectoryId);
  const selectedFileId = refFileId(selection, index);
  const selectedSymbolId = selection?.kind === "symbol" ? selection.id : null;
  const focusSet = useMemo(
    () => (focusedId ? new Set(index.filesUnder(focusedId)) : null),
    [focusedId, index],
  );
  const [buildingIds, setBuildingIds] = useState<string[]>([]);
  const signatureRef = useRef("");

  const material = useMemo(() => createBandMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);

  useThrottledFrame(
    BAND_HZ,
    `${layout.key}|${selectedFileId ?? ""}|${focusedId ?? ""}`,
    (state) => {
      const camera = snapshotCamera(state);
      const ids = selectSymbolBuildings(layout.buildings, {
        camera: camera.position,
        selectedFileId,
        // Buildings outside the focused directory are dimmed: no bands there.
        hasSymbols: (id) =>
          (index.filesById.get(id)?.symbolIds.length ?? 0) > 0 &&
          (!focusSet || focusSet.has(id) || id === selectedFileId),
        isVisible: (b, radius) => camera.sphereVisible(b.x, b.baseY + b.height / 2, b.z, radius),
      });
      const signature = ids.join("\n");
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setBuildingIds(ids);
    },
  );

  const entries = useMemo(() => {
    const collected: BandEntry[] = [];
    for (const id of buildingIds) {
      for (const entry of bands.entriesFor(id)) {
        if (collected.length >= MAX_BANDS) break;
        collected.push(entry);
      }
    }
    return collected;
  }, [buildingIds, bands]);

  const runtime = useMemo(() => createBandRuntime(entries, material), [entries, material]);
  useEffect(() => {
    reportLayerCount("instances", "symbol-bands", entries.length);
    return () => {
      disposeBandRuntime(runtime);
      reportLayerCount("instances", "symbol-bands", 0);
    };
  }, [runtime, entries]);

  useEffect(() => {
    if (!runtime) return;
    writeBandStates(runtime, useExplorerStore.getState(), index);
    return useExplorerStore.subscribe((state, previous) => {
      if (state.hovered !== previous.hovered || state.selection !== previous.selection) {
        writeBandStates(runtime, state, index);
      }
    });
  }, [runtime, index]);

  const labelEntries = useMemo(
    () => (selectedFileId ? bands.entriesFor(selectedFileId) : []),
    [bands, selectedFileId],
  );

  return (
    <group name="symbol-bands">
      {runtime ? (
        <BandMesh runtime={runtime} world={world} selectedFileId={selectedFileId} />
      ) : null}
      {labelEntries.length > 0 ? (
        <SymbolLabels entries={labelEntries} selectedSymbolId={selectedSymbolId} />
      ) : null}
    </group>
  );
}

function BandMesh({
  runtime,
  world,
  selectedFileId,
}: {
  runtime: BandRuntime;
  world: WorldContextValue;
  selectedFileId: string | null;
}) {
  if (!world.interactive) return <primitive object={runtime.mesh} />;
  const refAt = (instanceId: number | undefined) => {
    const symbol = instanceId === undefined ? undefined : runtime.entries[instanceId]?.symbol;
    return symbol ? bandPickRef(symbol, selectedFileId) : null;
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    world.hover.set(refAt(event.instanceId));
  };
  const onPointerOut = () => world.hover.set(null);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDragClick(event.delta)) return;
    event.stopPropagation();
    const ref = refAt(event.instanceId);
    if (ref) useExplorerStore.getState().select(ref);
  };
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const ref = refAt(event.instanceId);
    if (ref) useExplorerStore.getState().select(ref, { focus: true });
  };
  return (
    <primitive
      object={runtime.mesh}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
