import {
  estimateLabelWidth,
  labelPixelSize,
  rectsOverlap,
  selectDistrictLabels,
  type LabelCandidate,
  type Rect2,
} from "@/engine/lod/district-labels";
import type { Vec3Like } from "@/engine/lod/projection";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { DirectoryNode } from "@/graph/model/types";
import { formatInteger, pluralize } from "@/lib/utils/format";

/**
 * Turns the LOD label selection into concrete label views: text, on-screen
 * size and anchor. Pure (camera state and projection are passed in), so the
 * district-labels component only renders what this returns.
 */

export interface DistrictLabelView {
  id: string;
  text: string;
  subline: string | null;
  /** Anchor: the slab centre, at its top. The label stands above it. */
  x: number;
  y: number;
  z: number;
  /** On-screen size (px) of the name; the subline uses `SUBLINE_SCALE` of it. */
  pixelSize: number;
  inFocus: boolean;
}

export interface LabelCamera {
  position: Vec3Like;
  fovY: number;
  viewportHeight: number;
  /** World point -> screen pixels (y down), or null when behind the camera. */
  project: (x: number, y: number, z: number) => { x: number; y: number } | null;
}

export interface DistrictLabelInput {
  layout: WorldLayout;
  index: GraphIndex;
  camera: LabelCamera;
  focusedId: string | null;
  /** Ids labelled in the previous pass (hysteresis). */
  previous: ReadonlySet<string>;
  isVisible?: (candidate: LabelCandidate, radius: number) => boolean;
}

/** Minimum on-screen district size (px) for a label, and for its statistics subline. */
export const LABEL_MIN_PIXELS = 110;
export const SUBLINE_MIN_PIXELS = 280;
/** Subline size relative to the name. */
export const SUBLINE_SCALE = 0.74;
/** Line height of the name, in multiples of its size. */
const NAME_LINE_HEIGHT = 1.2;
/** Screen gap kept free around each label (px). */
const LABEL_GAP_PX = 6;
const NAME_MAX_CHARS = 28;

/** "12 FILES · ~4,281 LOC" — "~" marks line counts that include estimates. */
export function districtSubline(directory: DirectoryNode): string {
  const stats = directory.stats;
  const files = pluralize(stats.fileCount, "file").toUpperCase();
  const lines = `${stats.linesEstimated ? "~" : ""}${formatInteger(stats.totalLines)} LOC`;
  return `${files} · ${lines}`;
}

function displayName(directory: DirectoryNode | undefined, fallbackId: string): string {
  const raw = directory?.name ?? fallbackId.replace(/^dir:/, "").split("/").pop() ?? fallbackId;
  const chars = Array.from(raw.toUpperCase());
  return chars.length > NAME_MAX_CHARS
    ? `${chars.slice(0, NAME_MAX_CHARS - 1).join("")}…`
    : chars.join("");
}

/** Vertical offset (in name-size units) of the name above the anchor when a subline sits below it. */
export function nameOffset(hasSubline: boolean): number {
  return hasSubline ? SUBLINE_SCALE * NAME_LINE_HEIGHT : 0;
}

export function computeDistrictLabelViews(input: DistrictLabelInput): DistrictLabelView[] {
  const { layout, index, camera, focusedId } = input;
  const candidates: LabelCandidate[] = [];
  const districtsById = new Map(layout.districts.map((d) => [d.id, d] as const));
  for (const district of layout.districts) {
    // The root slab is the whole repository; its name is already in the UI chrome.
    if (district.level === 0) continue;
    const inFocus =
      !focusedId || district.id === focusedId || index.ancestorsOf(district.id).includes(focusedId);
    candidates.push({
      id: district.id,
      x: district.x,
      z: district.z,
      topY: district.baseY + district.height,
      width: district.width,
      depth: district.depth,
      level: district.level,
      inFocus,
    });
  }

  const picks = selectDistrictLabels(candidates, {
    camera: camera.position,
    fovY: camera.fovY,
    viewportHeight: camera.viewportHeight,
    minPixelSize: LABEL_MIN_PIXELS,
    sublinePixelSize: SUBLINE_MIN_PIXELS,
    maxPixelSize: camera.viewportHeight * 2.2,
    previous: input.previous,
    pinnedId: focusedId,
    isVisible: input.isVisible,
  });

  const inFocusById = new Map(candidates.map((c) => [c.id, c.inFocus] as const));
  const taken: Rect2[] = [];
  const views: DistrictLabelView[] = [];

  for (const pick of picks) {
    const district = districtsById.get(pick.id);
    if (!district) continue;
    const anchorY = district.baseY + district.height;
    const screen = camera.project(district.x, anchorY, district.z);
    if (!screen) continue;
    const directory = index.directoriesById.get(pick.id);
    const text = displayName(directory, pick.id);
    const subline = pick.subline && directory ? districtSubline(directory) : null;
    const pixelSize = labelPixelSize(district.level, pick.id === focusedId);

    const width = Math.max(
      estimateLabelWidth(text, pixelSize),
      subline ? estimateLabelWidth(subline, pixelSize * SUBLINE_SCALE) : 0,
    );
    const height = pixelSize * (NAME_LINE_HEIGHT + nameOffset(subline !== null));
    const rect: Rect2 = {
      minX: screen.x - width / 2 - LABEL_GAP_PX,
      maxX: screen.x + width / 2 + LABEL_GAP_PX,
      minY: screen.y - height - LABEL_GAP_PX,
      maxY: screen.y + LABEL_GAP_PX,
    };
    const pinned = pick.id === focusedId;
    if (!pinned && taken.some((other) => rectsOverlap(other, rect))) continue;
    taken.push(rect);
    views.push({
      id: pick.id,
      text,
      subline,
      x: district.x,
      y: anchorY,
      z: district.z,
      pixelSize,
      inFocus: inFocusById.get(pick.id) ?? true,
    });
  }
  return views;
}

/** Stable signature used to skip React updates when nothing visible changed. */
export function labelViewsSignature(views: readonly DistrictLabelView[]): string {
  return views
    .map((v) => `${v.id}|${v.pixelSize}|${v.text}|${v.subline ?? ""}|${v.inFocus ? 1 : 0}`)
    .join("\n");
}
