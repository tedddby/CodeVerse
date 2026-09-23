"use client";

import { useEffect, useState } from "react";
import type { AnalysisStatus } from "@/lib/analysis-client/analysis-state";

/**
 * Explorer page phases:
 *
 *   loading ──(analysis complete + world ready)──▶ entering ──(transition)──▶ explorer
 *      └──────────────(analysis error)──────────▶ error
 *
 * "entering" is the cinematic hand-over: the loading screen zooms away while
 * the world sharpens and the explorer chrome fades in.
 */
export type ExplorerPhase = "loading" | "entering" | "explorer" | "error";

/** Duration of the loading → explorer transition. */
export const ENTER_TRANSITION_MS = 1_000;
/** The loading screen stays up at least this long, so fast (cached) loads don't flash it. */
export const MIN_LOADING_MS = 1_100;

export interface ExplorerPhaseInput {
  status: AnalysisStatus;
  /** The world can be shown: the final graph's layout is computed, failed, or no WebGL. */
  worldReady: boolean;
  reducedMotion: boolean;
}

/** Pure phase derivation (exported for tests). */
export function derivePhase(input: ExplorerPhaseInput & { minimumShown: boolean; entered: boolean }): ExplorerPhase {
  if (input.status === "error") return "error";
  if (input.status !== "complete" || !input.worldReady || !input.minimumShown) return "loading";
  return input.entered ? "explorer" : "entering";
}

export function useExplorerPhase({ status, worldReady, reducedMotion }: ExplorerPhaseInput): ExplorerPhase {
  const [minimumShown, setMinimumShown] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumShown(true), reducedMotion ? 0 : MIN_LOADING_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  const phase = derivePhase({ status, worldReady, reducedMotion, minimumShown, entered });

  useEffect(() => {
    if (phase !== "entering") return;
    const timer = window.setTimeout(() => setEntered(true), reducedMotion ? 0 : ENTER_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);

  return phase;
}
