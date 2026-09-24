import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, NodeRef } from "@/graph/model/types";
import { getLanguageColor } from "@/lib/languages/registry";
import type { CameraPose, VisualMode } from "@/state/explorer-store";
import { cameraFootprint, rectToMinimap, type MinimapTransform } from "./minimap-geometry";

/**
 * Canvas drawing for the minimap. The static layer (districts, buildings,
 * selection) is drawn into an offscreen canvas only when its inputs change; the
 * dynamic layer composites that bitmap and the camera footprint on top.
 */

/** Subset of CanvasRenderingContext2D used here (keeps drawing testable with a recorder). */
export interface MinimapCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/** Token colors (see globals.css); canvas cannot read Tailwind classes. */
export const MINIMAP_COLORS = {
  background: "#070b13",
  root: "rgba(26, 36, 52, 0.35)",
  topDistrict: "rgba(42, 56, 80, 0.42)",
  nestedDistrict: "rgba(42, 56, 80, 0.2)",
  districtStroke: "rgba(98, 112, 137, 0.55)",
  label: "#9aa8bb",
  focus: "#4de2ff",
  selection: "#ffb454",
  camera: "#4de2ff",
} as const;

export interface StaticLayerInput {
  layout: WorldLayout;
  transform: MinimapTransform;
  index: GraphIndex;
  selection: NodeRef | null;
  focusedDirectoryId: string | null;
  visualMode: VisualMode;
  activeContributorId: string | null;
}

const LABEL_FONT = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";

/** Opacity of a building on the map for the current visual mode (0..1). */
export function buildingEmphasis(
  file: FileNode | undefined,
  index: GraphIndex,
  visualMode: VisualMode,
  activeContributorId: string | null,
): number {
  if (!file) return 0.5;
  switch (visualMode) {
    case "contributors": {
      // A contributor with no touched files in the analysed window highlights
      // nothing, so the map keeps its unfiltered look instead of going dark.
      const touched = activeContributorId
        ? index.contributorsById.get(activeContributorId)?.fileIds.length
        : undefined;
      if (!activeContributorId || !touched) return 0.8;
      return file.activity?.contributorIds.includes(activeContributorId) ? 1 : 0.14;
    }
    case "activity": {
      const range = index.activityRange;
      const last = file.activity?.lastModified
        ? Date.parse(file.activity.lastModified)
        : Number.NaN;
      if (!range || Number.isNaN(last)) return 0.18;
      const span = Math.max(1, range.max - range.min);
      return 0.2 + 0.8 * Math.min(1, Math.max(0, (last - range.min) / span));
    }
    case "complexity":
      return 0.2 + 0.8 * Math.min(1, file.lines / Math.max(1, index.maxima.lines));
    case "dependencies": {
      const degree =
        (index.dependenciesBySource.get(file.id)?.length ?? 0) +
        (index.dependenciesByTarget.get(file.id)?.length ?? 0);
      return degree === 0
        ? 0.18
        : 0.35 + 0.65 * Math.min(1, degree / Math.max(1, index.maxima.dependencyDegree));
    }
    default:
      return 0.9;
  }
}

/** Building (file) or district (directory) that represents the selection on the map. */
export function selectionTarget(
  selection: NodeRef | null,
  index: GraphIndex,
): { kind: "building" | "district"; id: string } | null {
  if (!selection) return null;
  if (selection.kind === "directory") return { kind: "district", id: selection.id };
  if (selection.kind === "file") return { kind: "building", id: selection.id };
  const symbol = index.symbolsById.get(selection.id);
  return symbol ? { kind: "building", id: symbol.fileId } : null;
}

function fitLabel(ctx: MinimapCanvasContext, text: string, maxWidth: number): string | null {
  if (maxWidth < 18) return null;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let length = text.length - 1;
  while (length > 1) {
    const candidate = `${text.slice(0, length)}…`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
    length -= 1;
  }
  return null;
}

export function drawStaticLayer(
  ctx: MinimapCanvasContext,
  input: StaticLayerInput,
  pixelRatio: number,
): void {
  const { layout, transform, index } = input;
  const size = transform.size;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = MINIMAP_COLORS.background;
  ctx.fillRect(0, 0, size, size);

  const districts = [...layout.districts].sort((a, b) => a.level - b.level);
  for (const district of districts) {
    const rect = rectToMinimap(transform, district.x, district.z, district.width, district.depth);
    ctx.fillStyle =
      district.level === 0
        ? MINIMAP_COLORS.root
        : district.level === 1
          ? MINIMAP_COLORS.topDistrict
          : MINIMAP_COLORS.nestedDistrict;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (district.level === 1) {
      ctx.strokeStyle = MINIMAP_COLORS.districtStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        rect.x + 0.5,
        rect.y + 0.5,
        Math.max(0, rect.width - 1),
        Math.max(0, rect.height - 1),
      );
    }
  }

  for (const building of layout.buildings) {
    const file = index.filesById.get(building.id);
    const rect = rectToMinimap(
      transform,
      building.x,
      building.z,
      building.width,
      building.depth,
      1,
    );
    ctx.globalAlpha = buildingEmphasis(file, index, input.visualMode, input.activeContributorId);
    ctx.fillStyle = file ? getLanguageColor(file.language) : MINIMAP_COLORS.label;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.globalAlpha = 1;

  // Labels for top-level districts, when there is room.
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "top";
  for (const district of districts) {
    if (district.level !== 1) continue;
    const rect = rectToMinimap(transform, district.x, district.z, district.width, district.depth);
    if (rect.height < 14) continue;
    const name = index.directoriesById.get(district.id)?.name;
    const label = name ? fitLabel(ctx, escapeHiddenCharacters(name), rect.width - 6) : null;
    if (!label) continue;
    ctx.fillStyle = MINIMAP_COLORS.background;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(rect.x + 2, rect.y + 2, ctx.measureText(label).width + 4, 11);
    ctx.globalAlpha = 1;
    ctx.fillStyle = MINIMAP_COLORS.label;
    ctx.fillText(label, rect.x + 4, rect.y + 3);
  }

  if (input.focusedDirectoryId) {
    const focused = layout.districts.find((district) => district.id === input.focusedDirectoryId);
    if (focused) {
      const rect = rectToMinimap(transform, focused.x, focused.z, focused.width, focused.depth);
      ctx.strokeStyle = MINIMAP_COLORS.focus;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  const target = selectionTarget(input.selection, index);
  if (target) {
    const shape =
      target.kind === "district"
        ? layout.districts.find((district) => district.id === target.id)
        : layout.buildings.find((building) => building.id === target.id);
    if (shape) {
      const rect = rectToMinimap(
        transform,
        shape.x,
        shape.z,
        shape.width,
        shape.depth,
        target.kind === "building" ? 3 : 0,
      );
      ctx.strokeStyle = MINIMAP_COLORS.selection;
      ctx.lineWidth = 2;
      if (target.kind === "building") {
        ctx.fillStyle = MINIMAP_COLORS.selection;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4);
      } else {
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
  }
}

export function drawDynamicLayer(
  ctx: MinimapCanvasContext,
  staticLayer: CanvasImageSource | null,
  transform: MinimapTransform,
  pose: CameraPose | null,
  pixelRatio: number,
): void {
  const size = transform.size;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, size, size);
  if (staticLayer) ctx.drawImage(staticLayer, 0, 0, size, size);
  if (!pose) return;

  const footprint = cameraFootprint(transform, pose);
  if (footprint.wedge) {
    ctx.beginPath();
    ctx.moveTo(footprint.position.x, footprint.position.y);
    ctx.lineTo(footprint.wedge.left.x, footprint.wedge.left.y);
    ctx.lineTo(footprint.wedge.right.x, footprint.wedge.right.y);
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = MINIMAP_COLORS.camera;
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = MINIMAP_COLORS.camera;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = MINIMAP_COLORS.camera;
  ctx.beginPath();
  ctx.arc(footprint.position.x, footprint.position.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Look-at point as a small crosshair.
  ctx.strokeStyle = MINIMAP_COLORS.camera;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(footprint.target.x - 3, footprint.target.y);
  ctx.lineTo(footprint.target.x + 3, footprint.target.y);
  ctx.moveTo(footprint.target.x, footprint.target.y - 3);
  ctx.lineTo(footprint.target.x, footprint.target.y + 3);
  ctx.stroke();
}
