import type { Rect2 } from "@/engine/lod/district-labels";
import { pixelsPerWorldUnit } from "@/engine/lod/projection";
import { screenBandSpans, selectSymbolLabels } from "@/engine/lod/symbols";
import type { BuildingLayout } from "@/engine/layout/types";
import type { LabelCamera } from "./district-label-views";
import { symbolLabelText, type BandEntry } from "./symbol-band-data";
import { bandProtrusion } from "./symbol-band-geometry";

/**
 * Which of the selected building's symbol bands carry a label, and where those
 * labels land on screen. Pure (the camera is passed in) and shared by the
 * labels themselves and by the district-label pass, which keeps clear of
 * them: for the same view both see exactly the same labels.
 *
 * A label is a billboard anchored on the building's axis at its band's
 * mid-height, pushed right (screen right) past the outermost collar, then a
 * small gap, then left-aligned, vertically centred text of constant size.
 */

/** On-screen size of a symbol label (px). */
export const SYMBOL_LABEL_PX = 11.5;
/** Minimum vertical distance between label centres on screen (px). */
export const SYMBOL_LABEL_SPACING_PX = 16;
/** Gap between the facade and the label (px). */
export const SYMBOL_LABEL_GAP_PX = 6;
/** Glyph advance of the monospaced label font (Geist Mono), in em. */
const GLYPH_ADVANCE_EM = 0.6;
/** Line height of a label, and its outline halo on each side, in em. */
const LINE_HEIGHT_EM = 1.2;
const HALO_EM = 0.08;

/** World distance from a building's axis to where its labels start: past its outermost collar. */
export function symbolLabelFacadeOffset(building: Pick<BuildingLayout, "width" | "depth">): number {
  return Math.hypot(building.width, building.depth) / 2 + bandProtrusion(building, 3);
}

/**
 * Ids of the bands (all on one building) that get a label in this view: at
 * most 25, largest first, never closer than a line of text on screen at any
 * pitch (see `selectSymbolLabels`), and always the selected symbol's band.
 */
export function pickSymbolLabels(
  entries: readonly BandEntry[],
  camera: Pick<LabelCamera, "project">,
  selectedSymbolId: string | null,
): Set<string> {
  const building = entries[0]?.building;
  if (!building) return new Set();
  // Labels sit beside the facade, so their screen y is the band's projected
  // height on the building's axis.
  const spans = screenBandSpans(
    entries.map((entry) => ({ id: entry.band.id, y0: entry.band.y0, y1: entry.band.y1 })),
    (y) => camera.project(building.x, y, building.z)?.y ?? null,
  );
  const ids = new Set(
    selectSymbolLabels(spans, SYMBOL_LABEL_SPACING_PX, undefined, selectedSymbolId).map(
      (span) => span.id,
    ),
  );
  if (selectedSymbolId && entries.some((entry) => entry.band.id === selectedSymbolId)) {
    ids.add(selectedSymbolId);
  }
  return ids;
}

/**
 * Screen rectangles (pixels, y down) of the labels of `labelIds`, halo
 * included. Labels whose anchor is behind the camera are left out.
 */
export function symbolLabelRects(
  entries: readonly BandEntry[],
  labelIds: ReadonlySet<string>,
  camera: LabelCamera,
): Rect2[] {
  const rects: Rect2[] = [];
  const halo = SYMBOL_LABEL_PX * HALO_EM;
  const halfHeight = (SYMBOL_LABEL_PX * LINE_HEIGHT_EM) / 2 + halo;
  for (const { band, building, symbol } of entries) {
    if (!labelIds.has(band.id)) continue;
    const y = (band.y0 + band.y1) / 2;
    const depth = camera.depth(building.x, y, building.z);
    const anchor = depth > 0 ? camera.project(building.x, y, building.z) : null;
    if (!anchor) continue;
    // Billboards are parallel to the image plane: a world offset along the
    // camera's right axis spans `perUnit` pixels per unit at the anchor's depth.
    const perUnit = pixelsPerWorldUnit(depth, camera.fovY, camera.viewportHeight);
    const left = anchor.x + symbolLabelFacadeOffset(building) * perUnit + SYMBOL_LABEL_GAP_PX;
    const width =
      Array.from(symbolLabelText(symbol.name)).length * SYMBOL_LABEL_PX * GLYPH_ADVANCE_EM;
    rects.push({
      minX: left - halo,
      maxX: left + width + halo,
      minY: anchor.y - halfHeight,
      maxY: anchor.y + halfHeight,
    });
  }
  return rects;
}

/** Screen rectangles of the labels the selected building shows in this view. */
export function selectedSymbolLabelRects(
  entries: readonly BandEntry[],
  camera: LabelCamera,
  selectedSymbolId: string | null,
): Rect2[] {
  return symbolLabelRects(entries, pickSymbolLabels(entries, camera, selectedSymbolId), camera);
}
