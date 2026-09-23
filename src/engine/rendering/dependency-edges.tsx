"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, LineSegments, type ShaderMaterial } from "three";
import { budgetDependencyEdges, type BudgetedEdge, type EdgeRole } from "@/engine/lod/edges";
import type { LayoutLookup } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";
import { useExplorerStore } from "@/state/explorer-store";
import { buildArcBuffers, type ArcSpec } from "./arc-geometry";
import { selectionFileIds } from "./encodings";
import { createEdgeMaterial } from "./materials/effect-materials";
import { setUniform } from "./materials/shader-chunks";
import { SCENE_HEX, hexToLinear } from "./palette";
import { reportLayerCount } from "./render-stats";
import { useWorld } from "./world-context";

/**
 * Dependency arcs between building tops, drawn as ONE merged LineSegments
 * geometry: a cyan (importer) -> violet (imported) gradient with a dash that
 * flows toward the imported file. Only a budgeted subset is drawn (see
 * `budgetDependencyEdges`); the flow freezes with reduced motion.
 */

const SOURCE_COLOR = hexToLinear(SCENE_HEX.signal);
const TARGET_COLOR = hexToLinear(SCENE_HEX.ion);

function intensityFor(role: EdgeRole, weight: number, maxWeight: number): number {
  switch (role) {
    case "outgoing":
    case "incoming":
    case "internal":
      return 1;
    case "focus":
      return 0.8;
    case "top":
      // Overview edges stay quiet; the heaviest imports read slightly brighter.
      return 0.15 + 0.4 * Math.sqrt(weight / Math.max(1, maxWeight));
  }
}

function buildEdgeObject(
  budgeted: readonly BudgetedEdge[],
  layout: WorldLayout,
  lookup: LayoutLookup,
  material: ShaderMaterial,
): LineSegments<BufferGeometry, ShaderMaterial> | null {
  if (budgeted.length === 0) return null;
  const maxWeight = budgeted.reduce((max, entry) => Math.max(max, entry.edge.weight), 1);
  const arcs: ArcSpec[] = [];
  for (const { edge, role } of budgeted) {
    const from = lookup.buildingsById.get(edge.source);
    const to = lookup.buildingsById.get(edge.target);
    if (!from || !to) continue;
    arcs.push({
      from: [from.x, from.baseY + from.height, from.z],
      to: [to.x, to.baseY + to.height, to.z],
      colorFrom: SOURCE_COLOR,
      colorTo: TARGET_COLOR,
      intensity: intensityFor(role, edge.weight, maxWeight),
    });
  }
  if (arcs.length === 0) return null;
  const buffers = buildArcBuffers(arcs, {
    segments: arcs.length > 800 ? 12 : 20,
    liftFactor: 0.35,
    minLift: 1.5,
    maxLift: Math.max(4, layout.bounds.size * 0.3),
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(buffers.colors, 3));
  geometry.setAttribute("aArc", new BufferAttribute(buffers.arcData, 3));
  geometry.computeBoundingSphere();
  const lines = new LineSegments(geometry, material);
  lines.name = "dependency-edges";
  // Transparent lines draw after buildings; slightly later than labels on slabs.
  lines.renderOrder = 3;
  return lines;
}

export function DependencyEdges() {
  const { layout, index, lookup } = useWorld();
  const active = useExplorerStore(
    (state) => state.showDependencies || state.visualMode === "dependencies",
  );
  const selection = useExplorerStore((state) => state.selection);
  const focusedId = useExplorerStore((state) => state.focusedDirectoryId);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);

  const material = useMemo(() => createEdgeMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    setUniform(material, "uDashSpacing", Math.max(1.5, layout.bounds.size * 0.02));
  }, [material, layout]);

  const budgeted = useMemo(() => {
    if (!active) return [];
    return budgetDependencyEdges(index.graph.dependencies, {
      selectedFileIds: selectionFileIds(selection, index),
      focusFileIds: focusedId ? new Set(index.filesUnder(focusedId)) : null,
      isDrawable: (fileId) => lookup.buildingsById.has(fileId),
    });
  }, [active, index, selection, focusedId, lookup]);

  const object = useMemo(
    () => buildEdgeObject(budgeted, layout, lookup, material),
    [budgeted, layout, lookup, material],
  );
  useEffect(() => {
    // Many overlapping arcs would add up to a solid web: thin them out as the count grows.
    setUniform(
      material,
      "uDensity",
      Math.min(1, Math.max(0.3, 400 / Math.max(1, budgeted.length))),
    );
    reportLayerCount("edges", "dependencies", object ? budgeted.length : 0);
    return () => {
      object?.geometry.dispose();
      reportLayerCount("edges", "dependencies", 0);
    };
  }, [object, budgeted, material]);

  const timeRef = useRef(0);
  useFrame((_, delta) => {
    if (!object || reducedMotion) return;
    timeRef.current += Math.min(delta, 0.1);
    setUniform(material, "uTime", timeRef.current);
  });

  return object ? <primitive object={object} /> : null;
}
