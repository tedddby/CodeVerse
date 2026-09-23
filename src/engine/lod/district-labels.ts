import { distance3, projectedSizePx, type Vec3Like } from "./projection";

/**
 * District label level of detail.
 *
 * District labels are map annotations: screen-facing, drawn above the city
 * at a constant on-screen size that encodes hierarchy. Which districts get a
 * label is decided by projected size, hierarchy and a hard budget; the
 * renderer then drops labels that would overlap on screen.
 */

export const DISTRICT_LABEL_BUDGET = 40;
/** Average advance of an uppercase glyph in em (conservative for sans fonts). */
export const UPPERCASE_ADVANCE_EM = 0.68;
/** Letter spacing used by district labels, in em. */
export const LABEL_LETTER_SPACING_EM = 0.14;

export interface LabelCandidate {
  id: string;
  /** Slab centre and top. */
  x: number;
  z: number;
  topY: number;
  width: number;
  depth: number;
  /** Nesting level (root = 0). */
  level: number;
  /** Inside the focused subtree (or no focus). */
  inFocus: boolean;
}

export interface LabelSelectionOptions {
  camera: Vec3Like;
  /** Vertical field of view in degrees. */
  fovY: number;
  viewportHeight: number;
  budget?: number;
  /** Minimum projected district size (px) to earn a label. */
  minPixelSize: number;
  /** Projected size (px) from which a district also gets a statistics subline. */
  sublinePixelSize: number;
  /**
   * Districts larger than this on screen are skipped (the camera is inside or
   * right above them; their label would only cover what the user is looking at).
   */
  maxPixelSize?: number;
  /** Optional frustum test for the district's bounding circle. */
  isVisible?: (candidate: LabelCandidate, radius: number) => boolean;
  /** Labels shown in the previous pass keep their place down to `hysteresis` × threshold. */
  previous?: ReadonlySet<string>;
  hysteresis?: number;
  /** Always labelled (with subline), e.g. the focused district. */
  pinnedId?: string | null;
}

export interface LabelPick {
  id: string;
  projectedSize: number;
  subline: boolean;
}

/**
 * Picks the districts that should carry a label, in priority order:
 * pinned first, then in-focus before out-of-focus, top-level before nested,
 * larger on screen before smaller. Result length never exceeds the budget.
 */
export function selectDistrictLabels(
  candidates: readonly LabelCandidate[],
  options: LabelSelectionOptions,
): LabelPick[] {
  const budget = Math.max(
    0,
    Math.min(options.budget ?? DISTRICT_LABEL_BUDGET, DISTRICT_LABEL_BUDGET),
  );
  if (budget === 0) return [];
  const hysteresis = options.hysteresis ?? 0.85;
  const maxPixelSize = options.maxPixelSize ?? Number.POSITIVE_INFINITY;
  const scored: Array<LabelPick & { level: number; inFocus: boolean; pinned: boolean }> = [];

  for (const candidate of candidates) {
    const size = Math.max(candidate.width, candidate.depth);
    const radius = Math.hypot(candidate.width, candidate.depth) / 2;
    const pinned = candidate.id === options.pinnedId;
    if (!pinned && options.isVisible && !options.isVisible(candidate, radius)) continue;
    const center = { x: candidate.x, y: candidate.topY, z: candidate.z };
    const projected = projectedSizePx(
      size,
      distance3(center, options.camera),
      options.fovY,
      options.viewportHeight,
    );
    const threshold = options.previous?.has(candidate.id)
      ? options.minPixelSize * hysteresis
      : options.minPixelSize;
    if (!pinned && (projected < threshold || projected > maxPixelSize)) continue;
    scored.push({
      id: candidate.id,
      projectedSize: projected,
      subline: pinned || projected >= options.sublinePixelSize,
      level: candidate.level,
      inFocus: candidate.inFocus,
      pinned,
    });
  }

  scored.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      Number(b.inFocus) - Number(a.inFocus) ||
      a.level - b.level ||
      b.projectedSize - a.projectedSize ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return scored
    .slice(0, budget)
    .map(({ id, projectedSize, subline }) => ({ id, projectedSize, subline }));
}

/** On-screen cap height (px) of a district label: top-level names read largest. */
export function labelPixelSize(level: number, focused: boolean): number {
  if (focused) return 16;
  if (level <= 1) return 14;
  if (level === 2) return 12.5;
  return 11.5;
}

/** Estimated rendered width of an uppercase label in the units of `fontSize`. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * UPPERCASE_ADVANCE_EM * (1 + LABEL_LETTER_SPACING_EM);
}

/** Axis-aligned rectangle (screen pixels or world units). */
export interface Rect2 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function rectsOverlap(a: Rect2, b: Rect2): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}
