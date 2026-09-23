import type { LayoutLookup } from "@/engine/layout/lookup";
import { layoutSymbolBands } from "@/engine/layout/symbol-bands";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, SymbolNode } from "@/graph/model/types";

/**
 * What the selection highlight should frame, and the corner-bracket geometry
 * for it. Pure data so it is unit-testable without WebGL.
 */

export interface Box3Like {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SelectionTarget {
  kind: "building" | "district" | "symbol";
  box: Box3Like;
  /** Ground level under the target (ring height). */
  groundY: number;
  /** Buildings and symbols get a beam above the roof; districts do not. */
  beam: boolean;
}

function boxAround(
  x: number,
  z: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
): Box3Like {
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minY,
    maxY,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}

export function selectionTarget(
  selection: NodeRef | null,
  layout: WorldLayout,
  lookup: LayoutLookup,
  index: GraphIndex,
): SelectionTarget | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "file": {
      const b = lookup.buildingsById.get(selection.id);
      if (!b) return null;
      return {
        kind: "building",
        box: boxAround(b.x, b.z, b.width, b.depth, b.baseY, b.baseY + b.height),
        groundY: b.baseY,
        beam: true,
      };
    }
    case "directory": {
      const d = lookup.districtsById.get(selection.id);
      // The root district is the whole world; bracketing it adds nothing.
      if (!d || d.level === 0) return null;
      return {
        kind: "district",
        box: boxAround(d.x, d.z, d.width, d.depth, d.baseY, d.baseY + d.height),
        groundY: d.baseY,
        beam: false,
      };
    }
    case "symbol": {
      const symbol = index.symbolsById.get(selection.id);
      const file = symbol ? index.filesById.get(symbol.fileId) : undefined;
      const b = file ? lookup.buildingsById.get(file.id) : undefined;
      if (!symbol || !file || !b) return null;
      const symbols = file.symbolIds
        .map((id) => index.symbolsById.get(id))
        .filter((s): s is SymbolNode => s !== undefined);
      const band = layoutSymbolBands(file, symbols, b).find((item) => item.id === symbol.id);
      const minY = band ? band.y0 : b.baseY;
      const maxY = band ? band.y1 : b.baseY + b.height;
      return {
        kind: "symbol",
        box: boxAround(b.x, b.z, b.width, b.depth, minY, maxY),
        groundY: b.baseY,
        beam: true,
      };
    }
  }
}

/** Expands a box horizontally (and vertically by `vertical`) by a padding. */
export function padBox(box: Box3Like, horizontal: number, vertical = 0): Box3Like {
  return {
    minX: box.minX - horizontal,
    maxX: box.maxX + horizontal,
    minY: box.minY - vertical,
    maxY: box.maxY + vertical,
    minZ: box.minZ - horizontal,
    maxZ: box.maxZ + horizontal,
  };
}

/**
 * Corner brackets: at each of the 8 box corners, three short arms along the
 * box edges (arm length a fraction of that edge). Returned as LineSegments
 * positions (2 vertices per arm, 48 vertices in total).
 */
export function bracketPositions(box: Box3Like, armFraction = 0.28): Float32Array {
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  const spanZ = box.maxZ - box.minZ;
  const armX = spanX * armFraction;
  const armY = spanY * armFraction;
  const armZ = spanZ * armFraction;
  const positions = new Float32Array(8 * 3 * 2 * 3);
  let offset = 0;
  const push = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    positions.set([x0, y0, z0, x1, y1, z1], offset);
    offset += 6;
  };
  for (const x of [box.minX, box.maxX]) {
    const dx = x === box.minX ? armX : -armX;
    for (const y of [box.minY, box.maxY]) {
      const dy = y === box.minY ? armY : -armY;
      for (const z of [box.minZ, box.maxZ]) {
        const dz = z === box.minZ ? armZ : -armZ;
        push(x, y, z, x + dx, y, z);
        push(x, y, z, x, y + dy, z);
        push(x, y, z, x, y, z + dz);
      }
    }
  }
  return positions;
}
