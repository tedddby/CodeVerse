"use client";

import { Activity, Building, Flame, Users, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { VISUAL_MODES, useExplorerStore, type VisualMode } from "@/state/explorer-store";

export const MODE_ICONS: Record<VisualMode, ReactNode> = {
  architecture: <Building />,
  dependencies: <Waypoints />,
  activity: <Activity />,
  contributors: <Users />,
  complexity: <Flame />,
};

/**
 * Segmented control for the five visual modes (keys 1–5). Labels collapse to
 * icons on narrower screens; tooltips carry the description and shortcut.
 */
export function ModeSwitcher({ className }: { className?: string }) {
  const visualMode = useExplorerStore((state) => state.visualMode);
  const setVisualMode = useExplorerStore((state) => state.setVisualMode);

  return (
    <div
      role="group"
      aria-label="Visual mode"
      className={cn("glass flex items-center gap-0.5 rounded-xl p-1", className)}
    >
      {VISUAL_MODES.map((mode, position) => {
        const active = mode.id === visualMode;
        const shortcut = String(position + 1);
        return (
          <span key={mode.id} className="group/tooltip relative inline-flex">
            <button
              type="button"
              aria-pressed={active}
              aria-label={`${mode.label} mode (${shortcut})`}
              aria-describedby={`mode-description-${mode.id}`}
              onClick={() => setVisualMode(mode.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors duration-150 2xl:px-2.5",
                active
                  ? "bg-signal/14 text-signal shadow-[inset_0_0_0_1px_rgba(77,226,255,0.35)]"
                  : "text-ink-muted hover:bg-panel-raised hover:text-ink",
              )}
            >
              <span aria-hidden="true" className="flex [&>svg]:size-4">
                {MODE_ICONS[mode.id]}
              </span>
              <span aria-hidden="true" className="max-2xl:hidden">
                {mode.label}
              </span>
            </button>
            <span
              id={`mode-description-${mode.id}`}
              role="tooltip"
              className="border-line-strong bg-panel-raised text-ink pointer-events-none absolute top-full left-1/2 z-50 mt-2 w-56 -translate-x-1/2 rounded-md border px-2.5 py-2 text-xs opacity-0 shadow-lg transition-opacity delay-300 duration-150 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100"
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {mode.label}
                <kbd className="kbd">{shortcut}</kbd>
              </span>
              <span className="text-ink-muted mt-1 block">{mode.description}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
