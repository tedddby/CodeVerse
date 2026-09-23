"use client";

import { useFrame, type RootState } from "@react-three/fiber";
import { useEffect, useRef } from "react";

/**
 * Runs `callback` from the render loop at most `hz` times per second (LOD
 * decisions, label selection). Whenever `version` changes the next frame runs
 * immediately, so inputs like focus or selection never wait for the throttle.
 * The callback may set React state, but should only do so when its result
 * actually changed.
 */
export function useThrottledFrame(
  hz: number,
  version: string,
  callback: (state: RootState) => void,
): void {
  const lastRunRef = useRef(Number.NEGATIVE_INFINITY);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    lastRunRef.current = Number.NEGATIVE_INFINITY;
  }, [version]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastRunRef.current < 1 / Math.max(0.1, hz)) return;
    lastRunRef.current = now;
    callbackRef.current(state);
  });
}
