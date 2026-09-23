"use client";

import { MonitorOff } from "lucide-react";
import { RepositorySummary } from "@/components/overlays/repository-summary";
import { CameraControlsBar } from "./camera-controls-bar";
import { CoverageBadge } from "./coverage-badge";
import { FirstVisitHint } from "./first-visit-hint";
import { FocusBreadcrumb } from "./focus-breadcrumb";
import { PerfOverlay } from "./perf-overlay";

/** Top-left heads-up stack under the top bar: coverage, focused directory, performance. */
export function HudStack({ perfOpen }: { perfOpen: boolean }) {
  return (
    <div className="pointer-events-none absolute left-2 top-[7.75rem] z-10 flex max-w-[calc(100vw-1rem)] flex-col items-start gap-2 md:left-3 md:max-w-[min(40rem,calc(100vw-26rem))] xl:top-[4.75rem]">
      <CoverageBadge />
      <FocusBreadcrumb />
      {perfOpen ? <PerfOverlay className="max-md:hidden" /> : null}
    </div>
  );
}

/** Controls that only make sense with the 3D world. */
export function WorldHud() {
  return (
    <>
      <CameraControlsBar />
      <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-4 md:bottom-6">
        <FirstVisitHint />
      </div>
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
    <div className="absolute inset-x-0 bottom-0 top-[10.25rem] overflow-y-auto pb-8 xl:top-[7.25rem]">
      {notice ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <div role="note" className="glass flex items-start gap-3 rounded-xl p-3 text-sm text-ink-muted">
            <MonitorOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
      <RepositorySummary standalone />
    </div>
  );
}
