"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * WebGL context loss is an event, not an exception, so error boundaries never
 * see it: the GPU process resets, a driver crashes or the browser reclaims the
 * context, and three.js silently stops drawing. This hook watches the canvas,
 * reports "lost" while the browser may still restore the context and "failed"
 * when it does not come back in time; `reload()` then remounts the canvas
 * (bump `generation`, used as its React key) with a fresh context.
 */

export type ContextStatus = "ok" | "lost" | "failed";

/** How long a lost context may take to come back before a reload is offered. */
export const CONTEXT_RESTORE_TIMEOUT_MS = 3_000;

export interface WebglContextWatch {
  status: ContextStatus;
  /** Changes on every reload; use it as the canvas key. */
  generation: number;
  /** Starts watching a freshly created canvas (call from R3F's onCreated). */
  watch: (canvas: HTMLCanvasElement) => void;
  /** Drops the current canvas and asks for a new one. */
  reload: () => void;
}

export function useWebglContextWatch(timeoutMs = CONTEXT_RESTORE_TIMEOUT_MS): WebglContextWatch {
  const [status, setStatus] = useState<ContextStatus>("ok");
  const [generation, setGeneration] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // Listeners live in an effect (not in onCreated) so StrictMode remounts re-attach them.
  useEffect(() => {
    if (!canvas) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const onLost = () => {
      console.warn("CodeVerse: the WebGL context was lost; waiting for the browser to restore it");
      clearTimer();
      setStatus("lost");
      timer = setTimeout(() => {
        timer = null;
        setStatus("failed");
      }, timeoutMs);
    };
    const onRestored = () => {
      console.warn("CodeVerse: the WebGL context was restored");
      clearTimer();
      setStatus("ok");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      clearTimer();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [canvas, timeoutMs]);

  const watch = useCallback((next: HTMLCanvasElement) => {
    setCanvas(next);
    setStatus("ok");
  }, []);

  const reload = useCallback(() => {
    // Stop listening first: unmounting the old canvas force-loses its context.
    setCanvas(null);
    setStatus("ok");
    setGeneration((value) => value + 1);
  }, []);

  return { status, generation, watch, reload };
}
