import type { BuildingLayout, SymbolBandLayout } from "@/engine/layout/types";
import type { SymbolKind } from "@/graph/model/types";
import { SYMBOL_KIND_HEX } from "./palette";

/**
 * Geometry of symbol bands: each band is a thin collar wrapped around its
 * building over the band's vertical range. Nested symbols (methods inside a
 * class) protrude slightly further than their parent so they stay visible as
 * ribs on the parent's collar instead of disappearing inside it.
 */

export type SymbolKindGroup = keyof typeof SYMBOL_KIND_HEX;

export function symbolKindGroup(kind: SymbolKind): SymbolKindGroup {
  switch (kind) {
    case "class":
    case "struct":
      return "structure";
    case "function":
    case "method":
      return "callable";
    case "interface":
    case "type":
    case "trait":
    case "enum":
      return "typeLike";
    case "constant":
    case "variable":
      return "value";
    case "module":
      return "module";
  }
}

export function symbolKindHex(kind: SymbolKind): string {
  return SYMBOL_KIND_HEX[symbolKindGroup(kind)];
}

export interface BandBox {
  /** Footprint centre and bottom of the collar. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

/** How far a collar of nesting depth `depth` stands out from the facade. */
export function bandProtrusion(
  building: Pick<BuildingLayout, "width" | "depth">,
  depth: number,
): number {
  const unit = Math.min(0.12, Math.max(0.02, Math.min(building.width, building.depth) * 0.025));
  return unit * (1 + Math.max(0, depth) * 0.7);
}

export function bandBox(
  building: Pick<BuildingLayout, "x" | "z" | "width" | "depth">,
  band: Pick<SymbolBandLayout, "y0" | "y1" | "depth">,
): BandBox {
  const protrusion = bandProtrusion(building, band.depth);
  const span = Math.max(0, band.y1 - band.y0);
  // A hairline gap keeps adjacent bands visually separate.
  const gap = Math.min(0.02, span * 0.08);
  return {
    x: building.x,
    y: band.y0 + gap,
    z: building.z,
    width: building.width + 2 * protrusion,
    height: Math.max(1e-3, span - 2 * gap),
    depth: building.depth + 2 * protrusion,
  };
}
