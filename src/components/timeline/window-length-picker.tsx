"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { WINDOW_OPTIONS } from "./timeline-model";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * Option a radio-group key moves to from `current` (-1 when none is checked),
 * wrapping at both ends; null for keys the group does not handle.
 */
export function nextOptionIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (NEXT_KEYS.has(key)) return current < 0 ? 0 : (current + 1) % count;
  if (PREVIOUS_KEYS.has(key)) return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export interface WindowLengthPickerProps {
  /** Selected window length in days. */
  value: number;
  onChange: (days: number) => void;
}

/**
 * The 7d / 30d / 90d / 1y window-length radio group. Follows the ARIA radio
 * group pattern: a single Tab stop on the checked option, and the arrow keys
 * (plus Home / End) move focus and selection together.
 */
export function WindowLengthPicker({ value, onChange }: WindowLengthPickerProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = WINDOW_OPTIONS.findIndex((option) => option.days === value);
  // With an unknown value nothing is checked; the first option keeps the group reachable.
  const tabStop = Math.max(0, checkedIndex);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = nextOptionIndex(event.key, checkedIndex, WINDOW_OPTIONS.length);
    const option = next === null ? undefined : WINDOW_OPTIONS[next];
    if (next === null || !option) return;
    event.preventDefault();
    onChange(option.days);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Window length"
      onKeyDown={onKeyDown}
      className="border-line-strong mr-1 flex rounded-lg border p-0.5"
    >
      {WINDOW_OPTIONS.map((option, position) => {
        const checked = position === checkedIndex;
        return (
          <button
            key={option.days}
            ref={(element) => {
              buttons.current[position] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.description}
            tabIndex={position === tabStop ? 0 : -1}
            onClick={() => onChange(option.days)}
            className={cn(
              "rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors",
              checked ? "bg-signal/15 text-signal" : "text-ink-subtle hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
