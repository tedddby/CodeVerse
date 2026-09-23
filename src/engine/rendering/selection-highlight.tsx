"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Group,
  type ShaderMaterial,
} from "three";
import { useExplorerStore } from "@/state/explorer-store";
import { easeOutCubic } from "@/engine/camera/tween";
import { createBeamMaterial } from "./materials/effect-materials";
import { setUniform } from "./materials/shader-chunks";
import { SCENE_HEX } from "./palette";
import {
  bracketPositions,
  padBox,
  selectionTarget,
  type SelectionTarget,
} from "./selection-geometry";
import { useWorld } from "./world-context";

/**
 * Selection highlight in flare amber (the color reserved for selection):
 * corner brackets around the selected building / band / district, a ring on
 * the ground and a soft beam above buildings so the selection is findable
 * from anywhere. Appears with a short settle animation (instant with reduced motion).
 */

const APPEAR_SECONDS = 0.3;
const BRACKET_OPACITY = 0.95;
const RING_OPACITY = 0.85;
const BEAM_OPACITY = 0.32;

interface MarkerParts {
  brackets: LineSegments<BufferGeometry, LineBasicMaterial>;
  ring: Mesh<RingGeometry, MeshBasicMaterial> | null;
  beam: Mesh<CylinderGeometry, ShaderMaterial> | null;
}

function createMarker(target: SelectionTarget, worldSize: number): MarkerParts {
  const { box } = target;
  const footprint = Math.min(box.maxX - box.minX, box.maxZ - box.minZ);
  const pad = footprint * 0.08 + 0.06;
  const padded = padBox(box, pad, target.kind === "district" ? 0 : pad * 0.5);
  const centerX = (box.minX + box.maxX) / 2;
  const centerZ = (box.minZ + box.maxZ) / 2;

  const bracketGeometry = new BufferGeometry();
  bracketGeometry.setAttribute("position", new BufferAttribute(bracketPositions(padded), 3));
  const brackets = new LineSegments(
    bracketGeometry,
    new LineBasicMaterial({
      color: SCENE_HEX.flare,
      transparent: true,
      opacity: BRACKET_OPACITY,
      toneMapped: false,
      // A HUD-style overlay: the selection stays findable behind other buildings.
      depthTest: false,
    }),
  );
  brackets.renderOrder = 10;

  let ring: MarkerParts["ring"] = null;
  let beam: MarkerParts["beam"] = null;
  if (target.kind !== "district") {
    const inner = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + pad * 2;
    const ringGeometry = new RingGeometry(inner, inner + Math.max(0.04, inner * 0.045), 64);
    ringGeometry.rotateX(-Math.PI / 2);
    ring = new Mesh(
      ringGeometry,
      new MeshBasicMaterial({
        color: SCENE_HEX.flare,
        transparent: true,
        opacity: RING_OPACITY,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    ring.position.set(centerX, target.groundY + 0.02, centerZ);
    ring.renderOrder = 9;
  }
  if (target.beam) {
    const height = Math.min(60, Math.max(8, worldSize * 0.12));
    const radius = Math.max(0.03, footprint * 0.05);
    beam = new Mesh(
      new CylinderGeometry(radius, radius, height, 16, 1, true),
      createBeamMaterial(SCENE_HEX.flare),
    );
    beam.position.set(centerX, box.maxY + height / 2, centerZ);
    beam.renderOrder = 9;
  }
  return { brackets, ring, beam };
}

function disposeMarker(parts: MarkerParts): void {
  parts.brackets.geometry.dispose();
  parts.brackets.material.dispose();
  parts.ring?.geometry.dispose();
  parts.ring?.material.dispose();
  parts.beam?.geometry.dispose();
  parts.beam?.material.dispose();
}

/** Applies the appear animation state (0..1) to every part. */
function applyAppear(
  parts: MarkerParts,
  group: Group | null,
  progress: number,
  pivot: [number, number, number],
): void {
  const t = easeOutCubic(progress);
  parts.brackets.material.opacity = BRACKET_OPACITY * t;
  if (parts.ring) parts.ring.material.opacity = RING_OPACITY * t;
  if (parts.beam) setUniform(parts.beam.material, "uOpacity", BEAM_OPACITY * t);
  if (group) {
    // Brackets settle inward onto the target.
    const scale = 1 + 0.25 * (1 - t);
    group.scale.setScalar(scale);
    group.position.set(pivot[0] * (1 - scale), pivot[1] * (1 - scale), pivot[2] * (1 - scale));
  }
}

export function SelectionHighlight() {
  const { layout, index, lookup } = useWorld();
  const selection = useExplorerStore((state) => state.selection);
  const target = useMemo(
    () => selectionTarget(selection, layout, lookup, index),
    [selection, layout, lookup, index],
  );
  if (!target || !selection) return null;
  return (
    <SelectionMarker
      key={`${selection.kind}:${selection.id}:${layout.key}`}
      target={target}
      worldSize={layout.bounds.size}
    />
  );
}

function SelectionMarker({ target, worldSize }: { target: SelectionTarget; worldSize: number }) {
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const parts = useMemo(() => createMarker(target, worldSize), [target, worldSize]);
  const groupRef = useRef<Group>(null);
  const progressRef = useRef(reducedMotion ? 1 : 0);
  const pivot = useMemo<[number, number, number]>(
    () => [
      (target.box.minX + target.box.maxX) / 2,
      (target.box.minY + target.box.maxY) / 2,
      (target.box.minZ + target.box.maxZ) / 2,
    ],
    [target],
  );

  useEffect(() => {
    applyAppear(parts, groupRef.current, progressRef.current, pivot);
    return () => disposeMarker(parts);
  }, [parts, pivot]);

  useFrame((_, delta) => {
    if (progressRef.current >= 1) return;
    progressRef.current = reducedMotion
      ? 1
      : Math.min(1, progressRef.current + delta / APPEAR_SECONDS);
    applyAppear(parts, groupRef.current, progressRef.current, pivot);
  });

  return (
    <group name="selection-highlight">
      <group ref={groupRef}>
        <primitive object={parts.brackets} />
      </group>
      {parts.ring ? <primitive object={parts.ring} /> : null}
      {parts.beam ? <primitive object={parts.beam} /> : null}
    </group>
  );
}
