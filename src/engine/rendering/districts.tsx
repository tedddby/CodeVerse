"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  LineBasicMaterial,
  LineSegments,
  type InstancedMesh,
  type ShaderMaterial,
} from "three";
import type { DistrictLayout, WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import { useExplorerStore } from "@/state/explorer-store";
import {
  buildOutlinePositions,
  OUTLINE_VERTICES_PER_DISTRICT,
  writeOutlineColor,
} from "./district-outlines";
import { districtStateKey, districtsToRewrite, type DistrictStateKey } from "./district-states";
import { createInstancedBoxes, writeBoxMatrix } from "./instanced-boxes";
import { createDistrictMaterial, DISTRICT_STATE } from "./materials/district-material";
import { hexToLinear, mixRgb, SCENE_HEX, scaleRgb, type Rgb } from "./palette";
import { isDragClick } from "./pointer";
import { reportLayerCount } from "./render-stats";
import { useWorld, type WorldContextValue } from "./world-context";

/**
 * District slabs (one InstancedMesh) with crisp top outlines (one merged
 * LineSegments). Hover brightens a district's outline in signal cyan, the
 * selected district is outlined in flare amber, and districts outside the
 * focused directory recede. Only focus changes rewrite every district; hover
 * and selection rewrite the (at most four) districts they touch.
 */

const SLAB_BASE = hexToLinear("#0a0f18");
const SLAB_DEEP = hexToLinear("#1b2638");
const LINE_STRONG = hexToLinear(SCENE_HEX.lineStrong);
const LINE = hexToLinear(SCENE_HEX.line);
const SIGNAL = hexToLinear(SCENE_HEX.signal);
const SIGNAL_DIM = hexToLinear(SCENE_HEX.signalDim);
const FLARE = hexToLinear(SCENE_HEX.flare);
const OUT_OF_FOCUS_SLAB_EMPHASIS = 0.45;

interface DistrictRuntime {
  slabs: InstancedMesh;
  slabState: InstancedBufferAttribute;
  outline: LineSegments<BufferGeometry, LineBasicMaterial>;
  outlineColors: BufferAttribute;
  /** District id -> instance index. */
  indexById: ReadonlyMap<string, number>;
}

// ─── Imperative helpers ─────────────────────────────────────────────────────

/** Slightly lighter slabs for deeper levels, so nesting reads as stacked terraces. */
function slabColor(level: number): Rgb {
  return mixRgb(SLAB_BASE, SLAB_DEEP, Math.min(1, level * 0.17));
}

function restingOutlineColor(level: number): Rgb {
  return mixRgb(LINE_STRONG, LINE, Math.min(1, Math.max(0, level - 1) * 0.25));
}

function createRuntime(layout: WorldLayout, material: ShaderMaterial): DistrictRuntime {
  const { districts, bounds } = layout;
  const count = districts.length;
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const slabState = new InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(
    DynamicDrawUsage,
  );
  const halfX = (bounds.maxX - bounds.minX) / 2;
  const halfZ = (bounds.maxZ - bounds.minZ) / 2;
  const slabs = createInstancedBoxes(
    count,
    material,
    { aColor: colors, aState: slabState },
    {
      center: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2],
      radius: Math.hypot(halfX, halfZ, bounds.maxY) + 1,
    },
  );
  slabs.name = "districts";
  const matrices = slabs.instanceMatrix.array as Float32Array;
  districts.forEach((district, i) => {
    writeBoxMatrix(
      matrices,
      i,
      district.x,
      district.baseY,
      district.z,
      district.width,
      district.height,
      district.depth,
    );
    const color = slabColor(district.level);
    colors.array[i * 3] = color[0];
    colors.array[i * 3 + 1] = color[1];
    colors.array[i * 3 + 2] = color[2];
    slabState.array[i * 2] = 1;
  });
  slabs.instanceMatrix.needsUpdate = true;

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(buildOutlinePositions(districts, 0.001), 3),
  );
  const outlineColors = new BufferAttribute(
    new Float32Array(count * OUTLINE_VERTICES_PER_DISTRICT * 3),
    3,
  ).setUsage(DynamicDrawUsage);
  geometry.setAttribute("color", outlineColors);
  geometry.computeBoundingSphere();
  const outline = new LineSegments(
    geometry,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    }),
  );
  outline.name = "district-outlines";
  const indexById = new Map(districts.map((district, i) => [district.id, i] as const));
  return { slabs, slabState, outline, outlineColors, indexById };
}

function disposeRuntime(runtime: DistrictRuntime): void {
  runtime.slabs.geometry.dispose();
  runtime.slabs.dispose();
  runtime.outline.geometry.dispose();
  runtime.outline.material.dispose();
}

/** Writes one district's slab emphasis/state and outline color. */
function writeDistrictState(
  runtime: DistrictRuntime,
  district: DistrictLayout,
  i: number,
  key: DistrictStateKey,
  focusChain: ReadonlySet<string> | null,
  index: GraphIndex,
): void {
  const { hoveredId, selectedId, focusedId } = key;
  // In focus: the focused directory, its subtree, and its ancestors (the ground it stands on).
  const inFocus =
    !focusedId ||
    focusChain?.has(district.id) === true ||
    index.ancestorsOf(district.id).includes(focusedId);
  const bits =
    (district.id === hoveredId ? DISTRICT_STATE.hovered : 0) |
    (district.id === selectedId ? DISTRICT_STATE.selected : 0) |
    (district.id === focusedId ? DISTRICT_STATE.focused : 0);
  const slabState = runtime.slabState.array;
  slabState[i * 2] = inFocus ? 1 : OUT_OF_FOCUS_SLAB_EMPHASIS;
  slabState[i * 2 + 1] = bits;

  let color: Rgb = restingOutlineColor(district.level);
  if (!inFocus) color = scaleRgb(color, 0.45);
  if (district.id === focusedId) color = SIGNAL_DIM;
  if (district.id === hoveredId) color = SIGNAL;
  if (district.id === selectedId) color = FLARE;
  writeOutlineColor(runtime.outlineColors.array as Float32Array, i, color);
}

/**
 * Brings slab state and outline colors from `previous` to `next`, touching
 * only the districts that changed. Both attributes are small, so they are
 * still uploaded whole: no update ranges to go stale between two writes.
 */
function writeDistrictStates(
  runtime: DistrictRuntime,
  layout: WorldLayout,
  index: GraphIndex,
  previous: DistrictStateKey | null,
  next: DistrictStateKey,
): void {
  const plan = districtsToRewrite(previous, next);
  if (plan !== "all" && plan.length === 0) return;
  const focusChain = next.focusedId ? new Set(index.ancestorsOf(next.focusedId)) : null;
  if (plan === "all") {
    layout.districts.forEach((district, i) =>
      writeDistrictState(runtime, district, i, next, focusChain, index),
    );
  } else {
    for (const id of plan) {
      const i = runtime.indexById.get(id);
      const district = i === undefined ? undefined : layout.districts[i];
      if (i !== undefined && district)
        writeDistrictState(runtime, district, i, next, focusChain, index);
    }
  }
  runtime.slabState.needsUpdate = true;
  runtime.outlineColors.needsUpdate = true;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function Districts() {
  const world = useWorld();
  const { layout, index } = world;

  const material = useMemo(() => {
    const created = createDistrictMaterial();
    // Push slab faces back in depth so coplanar outlines and labels always win.
    created.polygonOffset = true;
    created.polygonOffsetFactor = 1;
    created.polygonOffsetUnits = 1;
    return created;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  const runtime = useMemo(() => createRuntime(layout, material), [layout, material]);
  useEffect(() => {
    reportLayerCount("instances", "districts", layout.districts.length);
    return () => {
      disposeRuntime(runtime);
      reportLayerCount("instances", "districts", 0);
    };
  }, [runtime, layout]);

  useEffect(() => {
    let applied = districtStateKey(useExplorerStore.getState());
    writeDistrictStates(runtime, layout, index, null, applied);
    return useExplorerStore.subscribe((state) => {
      const next = districtStateKey(state);
      writeDistrictStates(runtime, layout, index, applied, next);
      applied = next;
    });
  }, [runtime, layout, index]);

  return (
    <group name="districts">
      <DistrictSlabs runtime={runtime} world={world} />
      <primitive object={runtime.outline} />
    </group>
  );
}

function DistrictSlabs({ runtime, world }: { runtime: DistrictRuntime; world: WorldContextValue }) {
  if (!world.interactive) return <primitive object={runtime.slabs} />;
  const districtAt = (instanceId: number | undefined) =>
    instanceId === undefined ? undefined : world.layout.districts[instanceId];

  // The root slab is the ground the city stands on: it is not hoverable and
  // clicking it clears the selection, like clicking empty space.
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const district = districtAt(event.instanceId);
    world.hover.set(district && district.level > 0 ? { kind: "directory", id: district.id } : null);
  };
  const onPointerOut = () => world.hover.set(null);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDragClick(event.delta)) return;
    event.stopPropagation();
    const district = districtAt(event.instanceId);
    if (!district) return;
    useExplorerStore
      .getState()
      .select(district.level > 0 ? { kind: "directory", id: district.id } : null);
  };
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const district = districtAt(event.instanceId);
    if (!district) return;
    const store = useExplorerStore.getState();
    if (district.level === 0) {
      // "Entering" the root means leaving any focus and seeing everything.
      store.focusDirectory(null);
      store.issueCameraCommand({ type: "focus-repository" });
    } else {
      store.focusDirectory(district.id);
    }
  };

  return (
    <primitive
      object={runtime.slabs}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
