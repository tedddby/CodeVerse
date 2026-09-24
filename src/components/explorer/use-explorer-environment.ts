"use client";

import { useEffect, useRef } from "react";
import { applyShareState, hasViewState } from "@/lib/share/explorer-share-state";
import type { ShareState } from "@/lib/share/url-state";
import { detectWebGL } from "@/lib/webgl";
import { useExplorerStore } from "@/state/explorer-store";
import { usePrefersReducedMotion } from "./use-media-query";

/**
 * Keeps environment flags in the store: live `prefers-reduced-motion` and a
 * one-time WebGL capability probe.
 */
export function useExplorerEnvironment(): void {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    useExplorerStore.getState().setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const store = useExplorerStore.getState();
    if (store.webglAvailable === null) store.setWebglAvailable(detectWebGL());
  }, []);
}

/**
 * Clears repository-specific store state when the explorer opens another
 * repository (or ref) and when it unmounts, so nothing leaks between visits.
 */
export function useRepositoryStoreLifecycle(
  owner: string,
  repo: string,
  ref: string | undefined,
): void {
  useEffect(() => {
    useExplorerStore.getState().reset();
    return () => useExplorerStore.getState().reset();
  }, [owner, repo, ref]);
}

/**
 * Runs once when the explorer opens (`ready`):
 * - applies the view state decoded from a shared link (mode, selection,
 *   camera pose without animation, ...);
 * - without a shared viewpoint, flies the camera from the loading backdrop's
 *   slow orbit to the overview pose, so opening the explorer feels like
 *   descending into the world rather than a cut.
 */
export function useExplorerEntrance(
  initial: ShareState,
  ready: boolean,
  worldEnabled: boolean,
): void {
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!ready || appliedRef.current) return;
    appliedRef.current = true;
    const store = useExplorerStore.getState();
    if (hasViewState(initial)) applyShareState(store, initial, { worldEnabled });
    if (worldEnabled && !initial.camera) store.issueCameraCommand({ type: "reset" });
  }, [ready, initial, worldEnabled]);
}
