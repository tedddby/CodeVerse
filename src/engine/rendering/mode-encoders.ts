import { getLanguageColor } from "@/lib/languages/registry";
import {
  contributorColor,
  dependencyDegree,
  filesActiveInWindow,
  filesTouchedBy,
  rankTopContributors,
  relatedFiles,
  selectionFileIds,
} from "./encoding-graph";
import { complexityScore, recencyScore } from "./encoding-scores";
import {
  DAY_MS,
  DIMMED_EMPHASIS,
  ENCODING_COLORS,
  clamp01,
  type EncodingContext,
  type FileEncoder,
} from "./encoding-types";
import {
  ACTIVITY_RAMP,
  COMPLEXITY_RAMP,
  CONTRIBUTOR_PALETTE,
  SCENE_HEX,
  desaturate,
  hexToLinear,
  mixRgb,
  sampleRamp,
  type Rgb,
} from "./palette";

/**
 * One encoder per visual mode. Each is built once per `computeBuildingVisuals`
 * call (precomputing its sets), then applied to every file.
 */

const { neutral: NEUTRAL, neutralBright: NEUTRAL_BRIGHT } = ENCODING_COLORS;

/** Language color; tests/docs/config slightly desaturated; generated/vendor dimmed. */
function architectureEncoder(): FileEncoder {
  return (file) => {
    const base = hexToLinear(getLanguageColor(file.language));
    if (file.isGenerated || file.category === "vendor") {
      return { color: desaturate(base, 0.6), emphasis: 0.4, glow: 0 };
    }
    if (file.category === "test" || file.category === "docs" || file.category === "config") {
      return { color: desaturate(base, 0.35), emphasis: 0.88, glow: 0 };
    }
    return { color: base, emphasis: 1, glow: 0 };
  };
}

/**
 * Without a selection: neutral-dim, files with dependencies brighter. With a
 * selection: imports cyan, dependents violet (both: mutual), the rest dimmed.
 */
function dependenciesEncoder(ctx: EncodingContext): FileEncoder {
  const { index } = ctx;
  const selected = selectionFileIds(ctx.selection, index);
  if (selected.size === 0) {
    const maxDegree = Math.max(1, index.maxima.dependencyDegree);
    return (file) => {
      const degree = dependencyDegree(file.id, index);
      const language = hexToLinear(getLanguageColor(file.language));
      if (degree === 0) return { color: mixRgb(NEUTRAL, language, 0.2), emphasis: 0.3, glow: 0 };
      const strength = Math.sqrt(degree / maxDegree);
      return {
        color: mixRgb(NEUTRAL_BRIGHT, language, 0.45),
        emphasis: 0.55 + 0.45 * strength,
        glow: 0.15 * strength,
      };
    };
  }
  const { outgoing, incoming } = relatedFiles(selected, index);
  return (file) => {
    if (selected.has(file.id)) {
      return { color: hexToLinear(getLanguageColor(file.language)), emphasis: 1, glow: 0.2 };
    }
    const isOut = outgoing.has(file.id);
    const isIn = incoming.has(file.id);
    if (isOut && isIn) return { color: ENCODING_COLORS.mutual, emphasis: 1, glow: 0.4 };
    if (isOut) return { color: ENCODING_COLORS.signal, emphasis: 1, glow: 0.4 };
    if (isIn) return { color: ENCODING_COLORS.ion, emphasis: 1, glow: 0.4 };
    return { color: NEUTRAL, emphasis: DIMMED_EMPHASIS, glow: 0 };
  };
}

/** Heat ramp by recency; with an active timeline cursor, only files active in the window light up. */
function activityEncoder(ctx: EncodingContext): FileEncoder {
  const { timeline, index } = ctx;
  if (timeline.active && timeline.cursor !== null && Number.isFinite(timeline.cursor)) {
    const cursor = timeline.cursor;
    const windowMs = Math.max(1, timeline.windowDays) * DAY_MS;
    const active = filesActiveInWindow(index, cursor, timeline.windowDays);
    const cold = desaturate(sampleRamp(ACTIVITY_RAMP, 0.1), 0.4);
    return (file) => {
      const time = active.get(file.id);
      if (time === undefined) return { color: cold, emphasis: DIMMED_EMPHASIS, glow: 0 };
      const position = clamp01(1 - (cursor - time) / windowMs);
      return {
        color: sampleRamp(ACTIVITY_RAMP, 0.55 + 0.45 * position),
        emphasis: 1,
        glow: 0.25 + 0.3 * position,
      };
    };
  }
  return (file) => {
    if (!file.activity?.lastModified) return { color: NEUTRAL, emphasis: 0.35, glow: 0 };
    const recency = recencyScore(file, ctx);
    return {
      color: sampleRamp(ACTIVITY_RAMP, recency),
      emphasis: 0.45 + 0.55 * recency,
      glow: recency > 0.85 ? ((recency - 0.85) / 0.15) * 0.25 : 0,
    };
  };
}

/**
 * Active contributor's files bright; otherwise last author in a categorical
 * palette. A contributor who touched no file in the analysed window keeps the
 * palette view instead of dimming the whole city (as the minimap does).
 */
function contributorsEncoder(ctx: EncodingContext): FileEncoder {
  const { index, activeContributorId } = ctx;
  const touched =
    activeContributorId && index.contributorsById.has(activeContributorId)
      ? filesTouchedBy(index, activeContributorId)
      : null;
  if (activeContributorId && touched && touched.size > 0) {
    const color = hexToLinear(contributorColor(index, activeContributorId) ?? SCENE_HEX.signal);
    return (file) => {
      if (!touched.has(file.id)) return { color: NEUTRAL, emphasis: DIMMED_EMPHASIS, glow: 0 };
      const lastAuthor = file.activity?.lastAuthorId === activeContributorId;
      return { color, emphasis: 1, glow: lastAuthor ? 0.4 : 0.2 };
    };
  }
  const palette = new Map<string, Rgb>();
  rankTopContributors(index).forEach((id, position) => {
    const hex = CONTRIBUTOR_PALETTE[position % CONTRIBUTOR_PALETTE.length] ?? SCENE_HEX.signal;
    palette.set(id, hexToLinear(hex));
  });
  return (file) => {
    const author = file.activity?.lastAuthorId;
    if (!author) return { color: NEUTRAL, emphasis: 0.4, glow: 0 };
    const color = palette.get(author);
    if (color) return { color, emphasis: 0.95, glow: 0 };
    return { color: NEUTRAL_BRIGHT, emphasis: 0.6, glow: 0 };
  };
}

/** Calm teal -> amber -> hot red-magenta by complexity; generated code stays quiet. */
function complexityEncoder(ctx: EncodingContext): FileEncoder {
  return (file) => {
    const score = complexityScore(file, ctx.index);
    // Lockfiles, bundles and vendored code are big but nobody maintains them by hand.
    if (file.isGenerated || file.category === "vendor") {
      return {
        color: desaturate(sampleRamp(COMPLEXITY_RAMP, score), 0.7),
        emphasis: 0.3,
        glow: 0,
      };
    }
    return {
      color: sampleRamp(COMPLEXITY_RAMP, score),
      emphasis: 0.4 + 0.6 * score,
      glow: score > 0.8 ? ((score - 0.8) / 0.2) * 0.3 : 0,
    };
  };
}

export function encoderFor(ctx: EncodingContext): FileEncoder {
  switch (ctx.visualMode) {
    case "architecture":
      return architectureEncoder();
    case "dependencies":
      return dependenciesEncoder(ctx);
    case "activity":
      return activityEncoder(ctx);
    case "contributors":
      return contributorsEncoder(ctx);
    case "complexity":
      return complexityEncoder(ctx);
  }
}
