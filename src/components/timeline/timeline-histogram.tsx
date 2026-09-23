"use client";

import { cn } from "@/lib/utils/cn";
import {
  cursorToSliderValue,
  formatDay,
  positionOf,
  sliderScale,
  sliderValueToCursor,
  type AxisTick,
  type HistogramBar,
  type TimelineExtent,
} from "./timeline-model";

export interface TimelineHistogramProps {
  bars: readonly HistogramBar[];
  ticks: readonly AxisTick[];
  extent: TimelineExtent;
  cursor: number;
  isLatest: boolean;
  windowStart: number;
  windowLabel: string;
  onCursorChange: (cursor: number | null) => void;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 48;

/**
 * Commit-activity histogram with the selected window highlighted, a cursor and
 * an (invisible, full-size) native range input for pointer and keyboard control.
 */
export function TimelineHistogram({
  bars,
  ticks,
  extent,
  cursor,
  isLatest,
  windowStart,
  windowLabel,
  onCursorChange,
}: TimelineHistogramProps) {
  const cursorPosition = positionOf(cursor, extent);
  const windowPosition = positionOf(windowStart, extent);
  const scale = sliderScale(extent);

  return (
    <div>
      <div className="border-line/60 bg-abyss/50 has-[input:focus-visible]:outline-signal relative h-12 rounded-md border has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {bars.map((bar) => {
            const x = positionOf(bar.start, extent) * VIEW_WIDTH;
            const width = Math.max(
              1,
              (positionOf(bar.end, extent) - positionOf(bar.start, extent)) * VIEW_WIDTH - 1.5,
            );
            const height = bar.height * (VIEW_HEIGHT - 6);
            const inWindow = bar.end > windowStart && bar.start < cursor;
            return (
              <rect
                key={bar.start}
                x={x}
                y={VIEW_HEIGHT - height}
                width={width}
                height={height}
                className={cn(inWindow ? "fill-signal" : "fill-ink-subtle/45")}
              />
            );
          })}
        </svg>
        <div
          aria-hidden="true"
          className="border-signal/40 bg-signal/[0.07] pointer-events-none absolute inset-y-0 border-l"
          style={{
            left: `${windowPosition * 100}%`,
            width: `${Math.max(0, cursorPosition - windowPosition) * 100}%`,
          }}
        />
        <div
          aria-hidden="true"
          className="bg-signal pointer-events-none absolute inset-y-0 w-px shadow-[0_0_8px_rgba(77,226,255,0.8)]"
          style={{ left: `${cursorPosition * 100}%` }}
        >
          <span className="border-void bg-signal absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full border" />
        </div>
        <input
          type="range"
          aria-label="Timeline position"
          aria-valuetext={`${formatDay(cursor)}${isLatest ? " (latest)" : ""}, showing ${windowLabel}`}
          min={0}
          max={scale.max}
          step={1}
          value={isLatest ? scale.max : cursorToSliderValue(cursor, extent, scale)}
          onChange={(event) => {
            // The last position means "follow the latest commit".
            onCursorChange(sliderValueToCursor(Number(event.currentTarget.value), extent, scale));
          }}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <div aria-hidden="true" className="text-ink-subtle relative mt-1 h-4 font-mono text-[10px]">
        {ticks.map((tick) => (
          <span
            key={tick.time}
            className="before:bg-line-strong absolute -translate-x-1/2 whitespace-nowrap before:mr-1 before:inline-block before:h-px before:w-2 before:align-middle"
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
