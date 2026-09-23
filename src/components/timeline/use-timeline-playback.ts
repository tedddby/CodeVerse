"use client";

import { useEffect, useState } from "react";
import { useExplorerStore } from "@/state/explorer-store";
import {
  advancePlayback,
  discretePlaybackStep,
  resolveCursor,
  type TimelineExtent,
} from "./timeline-model";

/** Store updates per second while playing smoothly (the world recolors on each one). */
const COMMIT_INTERVAL_MS = 100;
/** Interval between discrete steps when reduced motion is requested. */
const REDUCED_MOTION_STEP_MS = 900;

/**
 * Plays the timeline cursor from its current position (or the beginning, when
 * at "latest") to the end. Never starts on its own. With reduced motion the
 * cursor jumps one window at a time instead of sweeping continuously.
 */
export function useTimelinePlayback(
  extent: TimelineExtent | null,
  windowDays: number,
  reducedMotion: boolean,
): { playing: boolean; setPlaying: (playing: boolean) => void } {
  const [playing, setPlaying] = useState(false);
  const setTimeline = useExplorerStore((state) => state.setTimeline);

  useEffect(() => {
    if (!playing || !extent) return;
    const current = resolveCursor(useExplorerStore.getState().timeline.cursor, extent);
    let cursor = current >= extent.end ? extent.start : current;
    setTimeline({ cursor });

    if (reducedMotion) {
      const step = discretePlaybackStep(extent, windowDays);
      const timer = setInterval(() => {
        cursor = Math.min(extent.end, cursor + step);
        if (cursor >= extent.end) {
          setTimeline({ cursor: null });
          setPlaying(false);
        } else {
          setTimeline({ cursor });
        }
      }, REDUCED_MOTION_STEP_MS);
      return () => clearInterval(timer);
    }

    let frame = 0;
    let last = performance.now();
    let lastCommit = last;
    const tick = (now: number) => {
      const next = advancePlayback(cursor, extent, now - last);
      last = now;
      cursor = next.cursor;
      if (next.done) {
        setTimeline({ cursor: null });
        setPlaying(false);
        return;
      }
      if (now - lastCommit >= COMMIT_INTERVAL_MS) {
        lastCommit = now;
        setTimeline({ cursor });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, extent, windowDays, reducedMotion, setTimeline]);

  return { playing, setPlaying };
}
