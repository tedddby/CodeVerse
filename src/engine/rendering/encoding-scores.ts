import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode } from "@/graph/model/types";
import { dependencyDegree } from "./encoding-graph";
import { DAY_MS, clamp01, type EncodingContext } from "./encoding-types";

/** Time constant for absolute freshness in recency scoring. */
const FRESHNESS_TIME_CONSTANT_MS = 180 * DAY_MS;

/**
 * Structural complexity 0..1 from lines (log-scaled), symbol count and
 * dependency degree, normalized with `index.maxima`. Files whose structure was
 * never extracted (not parsed) are scored on size alone rather than being
 * penalized for "zero symbols" we simply do not know about.
 */
export function complexityScore(file: FileNode, index: GraphIndex): number {
  if (file.status === "binary") return 0;
  const maxLines = Math.max(1, index.maxima.lines);
  const lineScore = Math.log1p(Math.max(0, file.lines)) / Math.log1p(maxLines);
  const structureKnown = file.status === "parsed" || file.status === "partial";
  if (!structureKnown) return clamp01(lineScore);
  const symbolScore = Math.sqrt(file.symbolIds.length / Math.max(1, index.maxima.symbols));
  const degreeScore = Math.sqrt(
    dependencyDegree(file.id, index) / Math.max(1, index.maxima.dependencyDegree),
  );
  return clamp01(0.5 * lineScore + 0.28 * symbolScore + 0.22 * degreeScore);
}

/**
 * Recency 0..1 of a file's last modification: mostly its position within the
 * repository's own activity range (so every repository uses the full ramp),
 * blended with absolute freshness relative to `ctx.now` so long-dormant
 * repositories read cooler overall. Files without known activity score 0.
 */
export function recencyScore(file: FileNode, ctx: EncodingContext): number {
  const iso = file.activity?.lastModified;
  if (!iso) return 0;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  const range = ctx.index.activityRange;
  let relative = 1;
  if (range && range.max > range.min) {
    relative = clamp01((time - range.min) / (range.max - range.min));
  }
  if (!Number.isFinite(ctx.now) || ctx.now <= 0) return relative;
  const age = Math.max(0, ctx.now - time);
  const freshness = Math.exp(-age / FRESHNESS_TIME_CONSTANT_MS);
  return clamp01(0.8 * relative + 0.2 * freshness);
}
