"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorldLayout } from "@/engine/layout/types";
import { useExplorerStore, type ExplorerState } from "@/state/explorer-store";
import {
  createBuildingRuntime,
  disposeBuildingRuntime,
  flagsLookup,
  stateIndices,
  writeStateChange,
  writeVisuals,
  type ChunkRuntime,
  type StateIndices,
} from "./building-runtime";
import { computeBuildingVisuals } from "./encodings";
import { INTRO_DONE, INTRO_TOTAL_DURATION } from "./intro";
import {
  buildingScaleFor,
  createBuildingMaterial,
  setBuildingMaterialScale,
} from "./materials/building-material";
import { setUniform } from "./materials/shader-chunks";
import { isDragClick } from "./pointer";
import { reportLayerCount } from "./render-stats";
import { useWorld, type WorldContextValue } from "./world-context";

/**
 * Buildings: one InstancedMesh per spatial chunk (a single chunk for normal
 * repositories). Visual attributes are recomputed only when their inputs
 * change; hover and selection only rewrite per-instance state bits.
 */

export function Buildings() {
  const world = useWorld();
  const { layout, index } = world;
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const encodingInputs = useExplorerStore(
    useShallow((state) => ({
      visualMode: state.visualMode,
      selection: state.selection,
      focusedDirectoryId: state.focusedDirectoryId,
      activeContributorId: state.activeContributorId,
      timeline: state.timeline,
      showDependencies: state.showDependencies,
    })),
  );

  const material = useMemo(() => createBuildingMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    setBuildingMaterialScale(material, buildingScaleFor(layout.bounds.size, layout.bounds.maxY));
  }, [material, layout]);

  const runtime = useMemo(() => createBuildingRuntime(layout, material), [layout, material]);
  const buildingIds = useMemo(() => layout.buildings.map((b) => b.id), [layout]);
  const statesRef = useRef<StateIndices>({ hovered: -1, selected: -1 });

  useEffect(() => {
    reportLayerCount("instances", "buildings", layout.buildings.length);
    return () => {
      disposeBuildingRuntime(runtime);
      reportLayerCount("instances", "buildings", 0);
    };
  }, [runtime, layout]);

  // Visual encoding -> instance attributes (only when an input changes).
  useEffect(() => {
    const visuals = computeBuildingVisuals(buildingIds, {
      index,
      ...encodingInputs,
      // Hover is applied through state bits in the shader, not by recomputing everything.
      hovered: null,
      now: Date.now(),
    });
    const states = stateIndices(useExplorerStore.getState(), world);
    statesRef.current = states;
    writeVisuals(runtime, visuals, states, flagsLookup(layout, index));
  }, [runtime, buildingIds, layout, index, encodingInputs, world]);

  // Hover / selection -> state bits of at most four instances.
  useEffect(() => {
    const apply = (state: ExplorerState) => {
      const next = stateIndices(state, world);
      const previous = statesRef.current;
      if (next.hovered === previous.hovered && next.selected === previous.selected) return;
      statesRef.current = next;
      writeStateChange(runtime, previous, next);
    };
    apply(useExplorerStore.getState());
    return useExplorerStore.subscribe(apply);
  }, [runtime, world]);

  // World intro: buildings rise when a new repository's layout arrives.
  // introStart: null = idle, -1 = start on the next frame, otherwise clock time.
  const introKeyRef = useRef<string | null>(null);
  const introStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (introKeyRef.current === layout.key && !reducedMotion) return;
    if (introKeyRef.current !== layout.key) {
      introKeyRef.current = layout.key;
      introStartRef.current = reducedMotion ? null : -1;
      setUniform(material, "uIntro", reducedMotion ? INTRO_DONE : 0);
    } else {
      // Reduced motion switched on mid-intro: finish immediately.
      introStartRef.current = null;
      setUniform(material, "uIntro", INTRO_DONE);
    }
  }, [layout.key, reducedMotion, material]);

  useFrame(({ clock }) => {
    const start = introStartRef.current;
    if (start === null) return;
    const origin = start < 0 ? clock.elapsedTime : start;
    if (start < 0) introStartRef.current = origin;
    const elapsed = clock.elapsedTime - origin;
    if (elapsed >= INTRO_TOTAL_DURATION) {
      introStartRef.current = null;
      setUniform(material, "uIntro", INTRO_DONE);
    } else {
      setUniform(material, "uIntro", elapsed);
    }
  });

  return (
    <group name="buildings">
      {runtime.chunks.map((chunk) => (
        <BuildingChunkMesh key={chunk.key} chunk={chunk} layout={layout} world={world} />
      ))}
    </group>
  );
}

function BuildingChunkMesh({
  chunk,
  layout,
  world,
}: {
  chunk: ChunkRuntime;
  layout: WorldLayout;
  world: WorldContextValue;
}) {
  if (!world.interactive) return <primitive object={chunk.mesh} />;

  const idAt = (instanceId: number | undefined): string | null => {
    if (instanceId === undefined) return null;
    const global = chunk.indices[instanceId];
    return global === undefined ? null : (layout.buildings[global]?.id ?? null);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const id = idAt(event.instanceId);
    world.hover.set(id ? { kind: "file", id } : null);
  };
  const onPointerOut = () => world.hover.set(null);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDragClick(event.delta)) return;
    event.stopPropagation();
    const id = idAt(event.instanceId);
    if (id) useExplorerStore.getState().select({ kind: "file", id });
  };
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const id = idAt(event.instanceId);
    if (id) useExplorerStore.getState().select({ kind: "file", id }, { focus: true });
  };

  return (
    <primitive
      object={chunk.mesh}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
