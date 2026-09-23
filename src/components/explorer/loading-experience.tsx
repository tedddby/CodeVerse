"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { AnalysisStageId } from "@/analysis/protocol";
import type { AnalysisStatus, StageProgress } from "@/lib/analysis-client/analysis-state";
import { cn } from "@/lib/utils/cn";
import {
  buildStageRows,
  formatElapsed,
  loadingAnnouncement,
  renderBlockBar,
  tipForElapsed,
  type StageRowModel,
  type StageTone,
} from "./loading-display";

export interface LoadingExperienceProps {
  owner: string;
  repo: string;
  /** Requested branch/tag/commit, shown when not the default branch. */
  gitRef?: string;
  status: AnalysisStatus;
  stages: Record<AnalysisStageId, StageProgress>;
  warnings: string[];
  elapsedMs: number;
  /** The analysis finished but the 3D layout is still being computed. */
  layoutPending: boolean;
  /** Plays the exit transition (fade + zoom through) into the explorer. */
  exiting?: boolean;
}

const MARKERS: Record<StageTone, string> = {
  pending: "○",
  running: "◉",
  done: "✓",
  skipped: "–",
  warning: "!",
};

const TONE_CLASSES: Record<StageTone, { marker: string; label: string; detail: string }> = {
  pending: { marker: "text-ink-subtle/50", label: "text-ink-subtle/60", detail: "text-ink-subtle/60" },
  running: { marker: "text-signal animate-pulse-soft", label: "text-ink", detail: "text-signal" },
  done: { marker: "text-ok", label: "text-ink-muted", detail: "text-ok" },
  skipped: { marker: "text-ink-subtle", label: "text-ink-subtle", detail: "text-ink-subtle" },
  warning: { marker: "text-warn", label: "text-ink-muted", detail: "text-warn" },
};

function StageRow({ row }: { row: StageRowModel }) {
  const tone = TONE_CLASSES[row.tone];
  const percent = row.progress !== null ? Math.round(row.progress * 100) : null;
  return (
    <li
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-1 sm:grid-cols-[1.25rem_15.5rem_minmax(0,1fr)] sm:items-baseline",
        row.tone !== "pending" && "animate-fade-in",
      )}
    >
      <span aria-hidden="true" className={cn("text-center", tone.marker)}>
        {MARKERS[row.tone]}
      </span>
      <span className={cn("truncate", tone.label)}>{row.label}</span>
      <span className={cn("col-start-2 flex min-w-0 items-baseline gap-2 sm:col-start-3", tone.detail)}>
        {percent !== null ? (
          <>
            <span aria-hidden="true" className="shrink-0 tracking-[-0.06em]">
              {renderBlockBar(row.progress ?? 0)}
            </span>
            <span className="shrink-0 tabular-nums">
              {percent}%<span className="sr-only"> complete</span>
            </span>
          </>
        ) : null}
        {row.tone === "running" && percent === null ? (
          <span aria-hidden="true" className="animate-blink">
            ▋
          </span>
        ) : null}
        {row.detail ? <span className={cn("min-w-0 truncate", percent !== null && "text-ink-muted")}>{row.detail}</span> : null}
        {row.durationLabel ? <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-subtle">{row.durationLabel}</span> : null}
      </span>
    </li>
  );
}

/** Decorative animated backdrop: vignette over the preview world, orbit rings and a grid. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(4,6,11,0.35)_0%,rgba(4,6,11,0.88)_62%,rgba(4,6,11,0.97)_100%)]" />
      <div className="bg-grid absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      {[
        { size: "min(46rem,120vw)", duration: "38s", dot: "bg-signal" },
        { size: "min(66rem,170vw)", duration: "64s", dot: "bg-ion" },
        { size: "min(88rem,220vw)", duration: "96s", dot: "bg-signal/70" },
      ].map((ring) => (
        <div
          key={ring.size}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line/60"
          style={{ width: ring.size, height: ring.size }}
        >
          <div className="absolute inset-0 animate-orbit" style={{ animationDuration: ring.duration }}>
            <span className={cn("absolute left-1/2 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_12px_2px_rgba(77,226,255,0.45)]", ring.dot)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Cinematic, mission-control style progress screen shown while the analysis
 * streams. Renders over the dimmed preview world (if any) and zooms away into
 * the explorer when `exiting` is set.
 */
export function LoadingExperience({
  owner,
  repo,
  gitRef,
  status,
  stages,
  warnings,
  elapsedMs,
  layoutPending,
  exiting = false,
}: LoadingExperienceProps) {
  const fullName = `${owner}/${repo}`;
  const context = useMemo(() => ({ status, layoutPending }), [status, layoutPending]);
  const rows = useMemo(() => buildStageRows(stages, context), [stages, context]);
  const announcement = loadingAnnouncement(fullName, stages, context);

  return (
    <div
      inert={exiting}
      className={cn(
        "fixed inset-0 z-30 flex items-center justify-center overflow-y-auto px-4 py-10 transition-[opacity,transform,filter] duration-[900ms] ease-[cubic-bezier(0.7,0,0.84,0)]",
        exiting ? "pointer-events-none scale-[1.08] opacity-0 blur-[6px]" : "scale-100 opacity-100",
      )}
    >
      <Backdrop />
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <section aria-label={`Analyzing ${fullName}`} className="relative w-full max-w-[46rem] animate-fade-in">
        <div className="mb-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-signal/80">CodeVerse · Mission control</p>
          <h1 className="mt-3 break-all font-mono text-2xl leading-tight sm:text-4xl">
            <span className="text-ink-muted">{owner}/</span>
            <span className="text-ink">{repo}</span>
          </h1>
          <div className="mt-2 flex items-center justify-between gap-4 font-mono text-xs text-ink-subtle">
            <span className="truncate">{gitRef ? `ref ${gitRef}` : "default branch"}</span>
            <span className="shrink-0 tabular-nums" aria-label={`Elapsed time ${formatElapsed(elapsedMs)}`}>
              T+{formatElapsed(elapsedMs)}
            </span>
          </div>
        </div>

        <section aria-label="Analysis progress" className="glass relative overflow-hidden rounded-2xl px-4 py-4 shadow-2xl sm:px-6 sm:py-5">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="h-px w-1/3 animate-scan bg-linear-to-r from-transparent via-signal to-transparent" />
          </div>
          <ol className="font-mono text-[12.5px] leading-6 sm:text-[13px]">
            {rows.map((row) => (
              <StageRow key={row.id} row={row} />
            ))}
          </ol>

          {warnings.length > 0 ? (
            <div role="log" aria-label="Analysis notices" className="mt-4 space-y-1 border-t border-line/80 pt-3 font-mono text-xs">
              {warnings.map((warning) => (
                <p key={warning} className="flex gap-2 text-warn animate-fade-in">
                  <span aria-hidden="true">!</span>
                  <span className="text-ink-muted">{warning}</span>
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <footer className="mt-5 flex items-center justify-between gap-4 text-xs text-ink-subtle">
          <p className="min-w-0">{tipForElapsed(elapsedMs)}</p>
          <Link href="/" className="shrink-0 rounded font-mono text-ink-subtle transition-colors hover:text-ink">
            Cancel
          </Link>
        </footer>
      </section>
    </div>
  );
}
