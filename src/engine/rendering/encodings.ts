import type { FileNode } from "@/graph/model/types";
import { refFileId, relatedFiles } from "./encoding-graph";
import {
  ENCODING_COLORS,
  OUT_OF_FOCUS_EMPHASIS,
  clamp01,
  type BuildingVisuals,
  type Encoded,
  type EncodingContext,
} from "./encoding-types";
import { encoderFor } from "./mode-encoders";
import { mixRgb } from "./palette";

/**
 * Visual encodings: pure functions mapping graph data + explorer state to
 * per-building color / emphasis / glow. The renderer uploads the result into
 * instanced attributes; nothing here touches WebGL, so it is fully unit-tested.
 *
 * Module layout: types and constants (`encoding-types`), graph-derived sets
 * (`encoding-graph`), scores (`encoding-scores`), one encoder per visual mode
 * (`mode-encoders`); this module composes them and is the public entry point.
 */

export type { BuildingVisuals, EncodingContext } from "./encoding-types";
export { DIMMED_EMPHASIS, OUT_OF_FOCUS_EMPHASIS } from "./encoding-types";
export { complexityScore, recencyScore } from "./encoding-scores";
export {
  TOP_CONTRIBUTOR_COUNT,
  contributorColor,
  filesActiveInWindow,
  filesTouchedBy,
  rankTopContributors,
  refFileId,
  relatedFiles,
  selectionFileIds,
} from "./encoding-graph";

/** Bit flags describing how honestly a building's geometry reflects real data. */
export const BUILDING_FLAGS = {
  /** Lines are estimated / content never analysed (metadata-only, failed). */
  estimated: 1,
  /** Binary file: never parsed. */
  binary: 2,
  /** Generated, vendored or lockfile content. */
  generated: 4,
} as const;

export function buildingFlags(file: FileNode | undefined): number {
  if (!file) return BUILDING_FLAGS.estimated;
  let flags = 0;
  if (file.status === "metadata-only" || file.status === "failed" || file.linesEstimated) {
    flags |= BUILDING_FLAGS.estimated;
  }
  if (file.status === "binary") flags |= BUILDING_FLAGS.binary;
  if (file.isGenerated || file.category === "vendor") flags |= BUILDING_FLAGS.generated;
  return flags;
}

/**
 * Computes per-building visuals for the given building (file) ids, in order.
 *
 * Layering, applied in this order:
 * 1. Mode encoding (architecture / dependencies / activity / contributors / complexity).
 * 2. Binary files collapse toward grey slabs in every mode.
 * 3. With `showDependencies` outside dependencies mode, the selected file's
 *    imports and dependents get a faint glow so arc endpoints are findable.
 * 4. Focus: everything outside the focused directory is dimmed.
 * 5. Selection: always full emphasis plus glow (the flare outline itself is drawn separately).
 * 6. Hover: a subtle brighten.
 *
 * Unknown ids (stale layout) produce a dim neutral building.
 */
export function computeBuildingVisuals(
  buildingIds: readonly string[],
  ctx: EncodingContext,
): BuildingVisuals {
  const count = buildingIds.length;
  const colors = new Float32Array(count * 3);
  const emphasis = new Float32Array(count);
  const glow = new Float32Array(count);
  const { index } = ctx;

  const encode = encoderFor(ctx);
  const focusSet = ctx.focusedDirectoryId
    ? new Set(index.filesUnder(ctx.focusedDirectoryId))
    : null;
  const selectedFileId = refFileId(ctx.selection, index);
  const hoveredFileId = refFileId(ctx.hovered, index);
  const relationHints =
    ctx.showDependencies && ctx.visualMode !== "dependencies" && selectedFileId
      ? relatedFiles(new Set([selectedFileId]), index)
      : null;

  for (let i = 0; i < count; i += 1) {
    const id = buildingIds[i] ?? "";
    const file = index.filesById.get(id);
    let encoded: Encoded;
    if (!file) {
      encoded = { color: ENCODING_COLORS.neutral, emphasis: 0.3, glow: 0 };
    } else {
      encoded = encode(file);
      if (file.status === "binary") {
        encoded = {
          ...encoded,
          color: mixRgb(ENCODING_COLORS.binary, encoded.color, 0.25),
          glow: Math.min(encoded.glow, 0.1),
        };
      }
      if (relationHints && (relationHints.outgoing.has(id) || relationHints.incoming.has(id))) {
        encoded = {
          ...encoded,
          emphasis: Math.max(encoded.emphasis, 0.9),
          glow: Math.max(encoded.glow, 0.22),
        };
      }
    }

    let e = encoded.emphasis;
    let g = encoded.glow;
    if (focusSet && !focusSet.has(id)) {
      e = Math.min(e, OUT_OF_FOCUS_EMPHASIS);
      g = 0;
    }
    if (id === selectedFileId) {
      e = 1;
      g = Math.max(g, 0.3);
    }
    if (id === hoveredFileId) {
      e = Math.min(1, Math.max(e + 0.35, 0.75));
      g = g + 0.18;
    }

    colors[i * 3] = encoded.color[0];
    colors[i * 3 + 1] = encoded.color[1];
    colors[i * 3 + 2] = encoded.color[2];
    emphasis[i] = clamp01(e);
    glow[i] = clamp01(g);
  }

  return { colors, emphasis, glow };
}
