"use client";

import { MonitorOff } from "lucide-react";
import { RepositorySummary } from "@/components/overlays/repository-summary";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { CameraControlsBar } from "./camera-controls-bar";
import { CoverageBadge, StaleAnalysisNotice } from "./coverage-badge";
import { FirstVisitHint } from "./first-visit-hint";
import { FocusBreadcrumb } from "./focus-breadcrumb";
import { PerfOverlay } from "./perf-overlay";

/** Top-left heads-up stack under the top bar: coverage, analysis freshness, focused directory, performance. */
export function HudStack({ perfOpen }: { perfOpen: boolean }) {
  // The analytics/contributors panels dock in the same corner and repeat the
  // coverage details, so the stack steps aside instead of bleeding through them.
  const leftPanelOpen = useExplorerStore(
    (state) => state.panels.analytics || state.panels.contributors,
  );
  return (
    <div
      aria-hidden={leftPanelOpen || undefined}
      className={cn(
        "pointer-events-none absolute top-[7.75rem] left-2 z-10 flex max-w-[calc(100vw-1rem)] flex-col items-start gap-2 transition-opacity duration-200 md:left-3 md:max-w-[min(40rem,calc(100vw-26rem))] xl:top-[4.75rem]",
        leftPanelOpen && "invisible opacity-0",
      )}
    >
      <CoverageBadge />
      <StaleAnalysisNotice />
      <FocusBreadcrumb />
      {perfOpen ? <PerfOverlay className="max-md:hidden" /> : null}
    </div>
  );
}

/** Controls that only make sense with the 3D world. */
export function WorldHud() {
  // The history bar occupies the bottom edge; the hint would sit underneath it.
  const timelineOpen = useExplorerStore((state) => state.timeline.active);
  // On narrow screens the selection details open as a bottom sheet over the hint.
  const hasSelection = useExplorerStore((state) => state.selection !== null);
  return (
    <>
      <CameraControlsBar />
      {timelineOpen ? null : (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-4 md:bottom-6",
            hasSelection && "max-md:hidden",
          )}
        >
          <FirstVisitHint />
        </div>
      )}
    </>
  );
}

/**
 * Replaces the canvas when the 3D world cannot be shown: the accessible text
 * summary, plus an explicit notice when the reason is not already explained by
 * the summary itself (it covers missing WebGL).
 */
export function WorldUnavailable({ notice }: { notice: string | null }) {
  return (
    <div className="absolute inset-x-0 top-[10.25rem] bottom-0 overflow-y-auto pb-8 xl:top-[7.25rem]">
      {notice ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <div
            role="note"
            className="glass text-ink-muted flex items-start gap-3 rounded-xl p-3 text-sm"
          >
            <MonitorOff aria-hidden="true" className="text-warn mt-0.5 size-4 shrink-0" />
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
      <RepositorySummary standalone />
    </div>
  );
}
