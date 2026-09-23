"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { useRenderStats } from "./render-stats";

/**
 * Samples frame rate and renderer counters (gl.info) into `useRenderStats`
 * twice per second for the performance overlay. No per-frame React updates.
 */
const SAMPLE_SECONDS = 0.5;

export function StatsProbe() {
  const gl = useThree((state) => state.gl);
  const framesRef = useRef(0);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    framesRef.current += 1;
    elapsedRef.current += delta;
    if (elapsedRef.current < SAMPLE_SECONDS) return;
    // gl.info holds the previous frame's counters here (auto-reset per render).
    useRenderStats.getState().set({
      fps: Math.round(framesRef.current / elapsedRef.current),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    framesRef.current = 0;
    elapsedRef.current = 0;
  });
  return null;
}

/**
 * Lowers the pixel ratio when the frame rate cannot keep up and raises it
 * again when there is headroom (between 1 and min(2, devicePixelRatio)).
 */
export function AdaptiveResolution() {
  const setDpr = useThree((state) => state.setDpr);
  return (
    <PerformanceMonitor
      flipflops={3}
      onChange={({ factor }) => {
        const maxDpr = Math.min(
          2,
          typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
        );
        setDpr(1 + (maxDpr - 1) * factor);
      }}
      onFallback={() => setDpr(1)}
    />
  );
}
