import {
  estimateLabelWidth,
  labelPixelSize,
  rectsOverlap,
  selectDistrictLabels,
  type LabelCandidate,
  type Rect2,
} from "@/engine/lod/district-labels";
import type { Vec3Like } from "@/engine/lod/projection";
import type { DistrictLayout, WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { DirectoryNode } from "@/graph/model/types";
import { formatInteger, pluralize } from "@/lib/utils/format";

/**
 * Turns the LOD label selection into concrete label views: text, on-screen
 * size and anchor. Pure (camera state and projection are passed in), so the
 * district-labels component only renders what this returns.
 *
 * Placement reads like a map. A district's name stands at its centre, unless
 * labelled sub-districts occupy its interior (or its centre is off-screen or
 * too close to the top of the view): then it sits just inside the slab's near
 * (camera-facing) edge, slid along that edge to stay on screen, so a parent's
 * name never lands in the middle of a child's area. Districts without an
 * on-screen anchor are dropped before the label budget is applied; after it,
 * so are labels overlapping a higher-priority label or a reserved screen area.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A label that slides along its slab's near top edge (from a to b) to stay on screen. */
export interface LabelEdge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Slab top. */
  y: number;
  /** Half the label's width and its height above the anchor, in pixels. */
  halfWidth: number;
  headroom: number;
}

export interface DistrictLabelView {
  id: string;
  text: string;
  subline: string | null;
  /** Anchor on the slab top (its centre, or a point on its near edge). The label stands above it. */
  x: number;
  y: number;
  z: number;
  /** Set when the anchor was slid along the near edge: it follows the camera every frame. */
  slide: LabelEdge | null;
  /** On-screen size (px) of the name. */
  pixelSize: number;
  /** Subline size relative to the name. */
  sublineScale: number;
  inFocus: boolean;
}

export interface LabelCamera {
  position: Vec3Like;
  fovY: number;
  viewportWidth: number;
  viewportHeight: number;
  /** World point -> screen pixels (y down), or null when behind the camera. */
  project: (x: number, y: number, z: number) => ScreenPoint | null;
  /** View-space depth of a world point (distance along the view axis). */
  depth: (x: number, y: number, z: number) => number;
}

export interface DistrictLabelInput {
  layout: WorldLayout;
  index: GraphIndex;
  camera: LabelCamera;
  focusedId: string | null;
  /** Ids labelled in the previous pass (hysteresis). */
  previous: ReadonlySet<string>;
  isVisible?: (candidate: LabelCandidate, radius: number) => boolean;
  /**
   * Screen areas (pixels, y down) of other annotations that district labels
   * must keep clear of, such as the selected file's symbol labels: a district
   * label overlapping one is dropped, even the pinned one.
   */
  reserved?: readonly Rect2[];
}

/** Minimum on-screen district size (px) for a label, and for its statistics subline. */
export const LABEL_MIN_PIXELS = 110;
export const SUBLINE_MIN_PIXELS = 280;
/** Subline size relative to the name, and its smallest legible size on screen (px). */
export const SUBLINE_SCALE = 0.74;
export const SUBLINE_MIN_TEXT_PX = 11;
/** Lift of the label's baseline above its anchor (px), so it never touches the slab outline. */
export const BASELINE_LIFT_PX = 6;
/** Anchors keep this far inside the viewport (px). */
export const VIEWPORT_INSET_PX = 8;
/** Parents larger than this many viewport heights yield to their sub-districts' labels. */
const PARENT_YIELD_VIEWPORTS = 1.2;
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

/** Subline size relative to a name of `pixelSize`: SUBLINE_SCALE, but never below SUBLINE_MIN_TEXT_PX. */
export function sublineScaleFor(pixelSize: number): number {
  return Math.max(SUBLINE_SCALE, SUBLINE_MIN_TEXT_PX / Math.max(1, pixelSize));
}

/** Vertical offset (in name-size units) of the name above the anchor when a subline sits below it. */
export function nameOffset(view: Pick<DistrictLabelView, "subline" | "sublineScale">): number {
  return view.subline !== null ? view.sublineScale * NAME_LINE_HEIGHT : 0;
}

/** On-screen size (px) of a label's text: its name, and the subline below it when shown. */
export function labelExtent(
  view: Pick<DistrictLabelView, "text" | "subline" | "pixelSize" | "sublineScale">,
): { width: number; height: number } {
  const { text, subline, pixelSize, sublineScale } = view;
  return {
    width: Math.max(
      estimateLabelWidth(text, pixelSize),
      subline ? estimateLabelWidth(subline, pixelSize * sublineScale) : 0,
    ),
    height: pixelSize * NAME_LINE_HEIGHT * (1 + (subline ? sublineScale : 0)),
  };
}

/** Screen area of a label standing above `anchor`, including the gap kept free around it. */
export function labelScreenRect(
  anchor: ScreenPoint,
  extent: { width: number; height: number },
): Rect2 {
  const bottom = anchor.y - BASELINE_LIFT_PX;
  return {
    minX: anchor.x - extent.width / 2 - LABEL_GAP_PX,
    maxX: anchor.x + extent.width / 2 + LABEL_GAP_PX,
    minY: bottom - extent.height - LABEL_GAP_PX,
    maxY: bottom + LABEL_GAP_PX,
  };
}

/** Where anchors may sit: inside the viewport, with room above for a label `headroom` px tall. */
function anchorBounds(camera: LabelCamera, headroom: number, halfWidth = 0): Rect2 {
  return {
    minX: VIEWPORT_INSET_PX + halfWidth,
    maxX: camera.viewportWidth - VIEWPORT_INSET_PX - halfWidth,
    minY: VIEWPORT_INSET_PX + headroom,
    maxY: camera.viewportHeight - VIEWPORT_INSET_PX,
  };
}

function contains(rect: Rect2, point: ScreenPoint): boolean {
  return (
    point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  );
}

/** Liang–Barsky: the parameter range of segment a->b inside `rect`, or null. */
function clipSegment(a: ScreenPoint, b: ScreenPoint, rect: Rect2): [number, number] | null {
  if (rect.minX > rect.maxX || rect.minY > rect.maxY) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const sides: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dy, a.y - rect.minY],
    [dy, rect.maxY - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return null;
      t1 = Math.min(t1, r);
    }
  }
  return [t0, t1];
}

/**
 * The top edge of a slab nearest the viewer: of the edges whose corners are
 * in front of the camera, the one lowest on screen.
 */
export function nearEdge(
  district: Pick<DistrictLayout, "x" | "z" | "width" | "depth" | "baseY" | "height">,
  camera: LabelCamera,
): Omit<LabelEdge, "halfWidth" | "headroom"> | null {
  const y = district.baseY + district.height;
  const x0 = district.x - district.width / 2;
  const x1 = district.x + district.width / 2;
  const z0 = district.z - district.depth / 2;
  const z1 = district.z + district.depth / 2;
  const corners = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ] as const;
  const screens = corners.map(([x, z]) =>
    camera.depth(x, y, z) > 0 ? camera.project(x, y, z) : null,
  );
  let best: Omit<LabelEdge, "halfWidth" | "headroom"> | null = null;
  let bestY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    const a = screens[i];
    const b = screens[j];
    const ca = corners[i];
    const cb = corners[j];
    if (!a || !b || !ca || !cb) continue;
    const midY = (a.y + b.y) / 2;
    if (midY <= bestY) continue;
    bestY = midY;
    best = { ax: ca[0], az: ca[1], bx: cb[0], bz: cb[1], y };
  }
  return best;
}

export interface EdgePlacement {
  x: number;
  y: number;
  z: number;
  screen: ScreenPoint;
  /** False when the edge's midpoint is used as is. */
  slid: boolean;
}

/**
 * Anchors a label on `edge`: at the edge's midpoint when the label fits on
 * screen there, otherwise at the nearest point of the edge where it does
 * (letting it overhang the sides when the visible part is too short). Null
 * when no part of the edge is on screen.
 */
export function placeOnEdge(edge: LabelEdge, camera: LabelCamera): EdgePlacement | null {
  const a = camera.project(edge.ax, edge.y, edge.az);
  const b = camera.project(edge.bx, edge.y, edge.bz);
  const wa = camera.depth(edge.ax, edge.y, edge.az);
  const wb = camera.depth(edge.bx, edge.y, edge.bz);
  if (!a || !b || !(wa > 0) || !(wb > 0)) return null;
  const range =
    clipSegment(a, b, anchorBounds(camera, edge.headroom, edge.halfWidth)) ??
    clipSegment(a, b, anchorBounds(camera, edge.headroom));
  if (!range) return null;
  // Screen-space and world-space parameters differ under perspective (the
  // far half of an edge looks shorter): s = t·wb / ((1 − t)·wa + t·wb).
  const midpoint = wb / (wa + wb);
  const s = Math.min(range[1], Math.max(range[0], midpoint));
  const slid = s !== midpoint;
  const t = slid ? (s * wa) / ((1 - s) * wb + s * wa) : 0.5;
  return {
    x: edge.ax + (edge.bx - edge.ax) * t,
    y: edge.y,
    z: edge.az + (edge.bz - edge.az) * t,
    screen: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s },
    slid,
  };
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
      hasChildren: (index.directoriesById.get(district.id)?.childDirectoryIds.length ?? 0) > 0,
    });
  }

  // Projected anchor candidates, computed at most once per district and pass.
  const centres = new Map<string, ScreenPoint | null>();
  const edges = new Map<string, Omit<LabelEdge, "halfWidth" | "headroom"> | null>();
  const centreOf = (district: DistrictLayout): ScreenPoint | null => {
    let centre = centres.get(district.id);
    if (centre === undefined) {
      const top = district.baseY + district.height;
      centre = camera.project(district.x, top, district.z);
      centres.set(district.id, centre);
    }
    return centre;
  };
  const edgeOf = (district: DistrictLayout) => {
    let edge = edges.get(district.id);
    if (edge === undefined) {
      edge = nearEdge(district, camera);
      edges.set(district.id, edge);
    }
    return edge;
  };
  const nameHeadroom = (district: DistrictLayout) =>
    BASELINE_LIFT_PX + labelPixelSize(district.level, district.id === focusedId) * NAME_LINE_HEIGHT;
  /** Cheap pre-budget test: can this district's name be anchored on screen at all? */
  const hasOnScreenAnchor = (candidate: LabelCandidate): boolean => {
    const district = districtsById.get(candidate.id);
    if (!district) return false;
    const headroom = nameHeadroom(district);
    const centre = centreOf(district);
    if (centre && contains(anchorBounds(camera, headroom), centre)) return true;
    const edge = edgeOf(district);
    return edge !== null && placeOnEdge({ ...edge, halfWidth: 0, headroom }, camera) !== null;
  };

  const picks = selectDistrictLabels(candidates, {
    camera: camera.position,
    fovY: camera.fovY,
    viewportHeight: camera.viewportHeight,
    minPixelSize: LABEL_MIN_PIXELS,
    sublinePixelSize: SUBLINE_MIN_PIXELS,
    maxPixelSize: camera.viewportHeight * 2.2,
    yieldPixelSize: camera.viewportHeight * PARENT_YIELD_VIEWPORTS,
    previous: input.previous,
    pinnedId: focusedId,
    isVisible: (candidate, radius) =>
      (input.isVisible?.(candidate, radius) ?? true) && hasOnScreenAnchor(candidate),
  });

  // Districts with a labelled sub-district: their own name moves to the near edge.
  const labelledAncestors = new Set<string>();
  for (const pick of picks) {
    let parent = index.directoriesById.get(pick.id)?.parentId ?? null;
    while (parent !== null && !labelledAncestors.has(parent)) {
      labelledAncestors.add(parent);
      parent = index.directoriesById.get(parent)?.parentId ?? null;
    }
  }

  const inFocusById = new Map(candidates.map((c) => [c.id, c.inFocus] as const));
  const reserved = input.reserved ?? [];
  const taken: Rect2[] = [];
  const views: DistrictLabelView[] = [];

  for (const pick of picks) {
    const district = districtsById.get(pick.id);
    if (!district) continue;
    const directory = index.directoriesById.get(pick.id);
    const text = displayName(directory, pick.id);
    const subline = pick.subline && directory ? districtSubline(directory) : null;
    const pixelSize = labelPixelSize(district.level, pick.id === focusedId);
    const sublineScale = sublineScaleFor(pixelSize);
    const extent = labelExtent({ text, subline, pixelSize, sublineScale });
    const { width, height } = extent;
    const headroom = BASELINE_LIFT_PX + height;

    const top = district.baseY + district.height;
    const centre = labelledAncestors.has(pick.id) ? null : centreOf(district);
    let anchor: { x: number; z: number; screen: ScreenPoint; slide: LabelEdge | null } | null =
      centre && contains(anchorBounds(camera, headroom), centre)
        ? { x: district.x, z: district.z, screen: centre, slide: null }
        : null;
    if (!anchor) {
      const edge = edgeOf(district);
      const spec: LabelEdge | null = edge ? { ...edge, halfWidth: width / 2, headroom } : null;
      const placed = spec ? placeOnEdge(spec, camera) : null;
      if (!placed) continue;
      anchor = {
        x: placed.x,
        z: placed.z,
        screen: placed.screen,
        slide: placed.slid ? spec : null,
      };
    }

    const rect = labelScreenRect(anchor.screen, extent);
    if (reserved.some((area) => rectsOverlap(area, rect))) continue;
    const pinned = pick.id === focusedId;
    if (!pinned && taken.some((other) => rectsOverlap(other, rect))) continue;
    taken.push(rect);
    views.push({
      id: pick.id,
      text,
      subline,
      x: anchor.x,
      y: top,
      z: anchor.z,
      slide: anchor.slide,
      pixelSize,
      sublineScale,
      inFocus: inFocusById.get(pick.id) ?? true,
    });
  }
  return views;
}

/**
 * Stable signature used to skip React updates when nothing visible changed.
 * Sliding anchors are placed every frame, so only their edge matters here.
 */
export function labelViewsSignature(views: readonly DistrictLabelView[]): string {
  const round = (n: number) => Math.round(n * 100) / 100;
  return views
    .map((v) => {
      const anchor = v.slide ? "slide" : `${round(v.x)},${round(v.z)}`;
      return `${v.id}|${v.pixelSize}|${v.text}|${v.subline ?? ""}|${v.inFocus ? 1 : 0}|${anchor}`;
    })
    .join("\n");
}
