"use client";

import { useFrame, type RootState } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { ViewStamp } from "./view-stamp";

/**
 * Runs `callback` from the render loop at most `hz` times per second (LOD
 * decisions, label selection), and only when its inputs changed: the camera
 * pose, projection or viewport since the last run, or `version`. Whenever
 * `version` changes the next frame runs immediately, so inputs like focus or
 * selection never wait for the throttle. Callbacks must therefore depend only
 * on the view and on what `version` encodes. The callback may set React
 * state, but should only do so when its result actually changed.
 */
export function useThrottledFrame(
  hz: number,
  version: string,
  callback: (state: RootState) => void,
): void {
  const lastRunRef = useRef(Number.NEGATIVE_INFINITY);
  const callbackRef = useRef(callback);
  const view = useMemo(() => new ViewStamp(), []);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    lastRunRef.current = Number.NEGATIVE_INFINITY;
    view.invalidate();
  }, [version, view]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastRunRef.current < 1 / Math.max(0.1, hz)) return;
    lastRunRef.current = now;
    // An idle view gives the same answer: skip the pass entirely.
    if (!view.update(state.camera, state.size)) return;
    callbackRef.current(state);
  });
}
