import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, NodeRef } from "@/graph/model/types";
import type { TimelineState, VisualMode } from "@/state/explorer-store";
import { RENDER_HEX, SCENE_HEX, hexToLinear, type Rgb } from "./palette";

/**
 * Shared types and constants of the visual encodings (see `encodings.ts`).
 *
 * Emphasis is 0 (dimmed: desaturated and darkened in the shader) .. 1 (full).
 * Glow is an emissive boost 0..1 reserved for meaning (selection, relations,
 * hot spots) — most buildings have none.
 */
export interface EncodingContext {
  index: GraphIndex;
  visualMode: VisualMode;
  selection: NodeRef | null;
  hovered: NodeRef | null;
  focusedDirectoryId: string | null;
  activeContributorId: string | null;
  timeline: TimelineState;
  showDependencies: boolean;
  /** Epoch ms used for absolute freshness; inject for deterministic tests. */
  now: number;
}

export interface BuildingVisuals {
  /** Linear RGB triplets, one per building. */
  colors: Float32Array;
  /** 0 dimmed .. 1 full, one per building. */
  emphasis: Float32Array;
  /** 0..1 emissive boost, one per building. */
  glow: Float32Array;
}

/** Visual encoding of a single file. */
export interface Encoded {
  color: Rgb;
  emphasis: number;
  glow: number;
}

export type FileEncoder = (file: FileNode) => Encoded;

/** Emphasis applied to buildings that are not part of the current story. */
export const DIMMED_EMPHASIS = 0.18;
/** Emphasis of everything outside the focused directory. */
export const OUT_OF_FOCUS_EMPHASIS = 0.15;

export const DAY_MS = 86_400_000;

/** Linear colors shared by the encoders. */
export const ENCODING_COLORS = {
  neutral: hexToLinear(RENDER_HEX.neutral),
  neutralBright: hexToLinear(RENDER_HEX.neutralBright),
  binary: hexToLinear(RENDER_HEX.binary),
  signal: hexToLinear(SCENE_HEX.signal),
  ion: hexToLinear(SCENE_HEX.ion),
  mutual: hexToLinear(RENDER_HEX.mutual),
} as const;

export const clamp01 = (value: number) =>
  value <= 0 ? 0 : value >= 1 ? 1 : Number.isFinite(value) ? value : 0;
