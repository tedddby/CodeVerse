"use client";

import { GitCommitHorizontal, Pause, Play, SkipForward, X } from "lucide-react";
import { useMemo } from "react";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { IconButton } from "@/components/ui/icon-button";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import { cn } from "@/lib/utils/cn";
import { formatInteger, pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { TimelineHistogram } from "./timeline-histogram";
import {
  axisTicks,
  formatWindowRange,
  histogramBars,
  resolveCursor,
  timelineExtent,
  WINDOW_OPTIONS,
  windowStats,
  type WindowStats,
} from "./timeline-model";
import { useTimelinePlayback } from "./use-timeline-playback";
import { WindowLengthPicker } from "./window-length-picker";

/**
 * Bottom centre. Below lg the bar spans the width, so it sits above the camera
 * controls in the bottom-right corner; from lg it fits between the minimap
 * (bottom-left) and the camera controls.
 */
const BAR_CLASS = [
  "glass fixed bottom-[3.75rem] left-1/2 z-30 w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-2xl px-4 pb-3 pt-2.5 shadow-2xl",
  // From lg the bar is bounded by the minimap (left) and the camera controls
  // (right) and centred within that span by auto margins, up to 50rem wide.
  "lg:bottom-3 lg:left-[15rem] lg:right-[15rem] lg:mx-auto lg:w-auto lg:max-w-[50rem] lg:translate-x-0",
].join(" ");

/** With the selection panel docked on the right, the bar stops short of it. */
const BESIDE_SELECTION_CLASS = "lg:right-[25rem]";

/**
 * Bottom-centre history bar (`timeline.active`, shortcut "T"): commit activity
 * over time, a cursor + window that drive the world's activity highlighting,
 * playback, and what changed in the selected window.
 */
export function Timeline() {
  const active = useExplorerStore((state) => state.timeline.active);
  const index = useExplorerStore((state) => state.index);
  if (!active || !index) return null;
  return <TimelineBar index={index} />;
}

function TimelineBar({ index }: { index: GraphIndex }) {
  const { graph } = index;
  const timeline = useExplorerStore((state) => state.timeline);
  const setTimeline = useExplorerStore((state) => state.setTimeline);
  const select = useExplorerStore((state) => state.select);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const selectionOpen = useExplorerStore((state) => state.selection !== null);

  const extent = useMemo(() => timelineExtent(graph), [graph]);
  const bars = useMemo(() => histogramBars(graph.timeline.buckets), [graph.timeline.buckets]);
  const ticks = useMemo(() => (extent ? axisTicks(extent, 7) : []), [extent]);
  const { playing, setPlaying } = useTimelinePlayback(extent, timeline.windowDays, reducedMotion);
  const cursor = extent ? resolveCursor(timeline.cursor, extent) : null;
  const stats = useMemo(
    () => (cursor === null ? null : windowStats(graph, cursor, timeline.windowDays)),
    [graph, cursor, timeline.windowDays],
  );

  const close = () => {
    setPlaying(false);
    setTimeline({ active: false });
  };
  const history = graph.analysis.history;
  const coverageLabel =
    graph.timeline.coverage === "full-history"
      ? "Full history"
      : `Based on the latest ${pluralize(history.commitsFetched, "commit")}`;
  const windowOption = WINDOW_OPTIONS.find((option) => option.days === timeline.windowDays);

  return (
    <section
      aria-label="History timeline"
      className={cn(
        BAR_CLASS,
        selectionOpen && BESIDE_SELECTION_CLASS,
        !reducedMotion && "animate-slide-up",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitCommitHorizontal aria-hidden="true" className="text-signal size-4" />
          <h2 className="text-ink text-sm font-semibold">History</h2>
          {extent ? (
            <Badge
              tone={graph.timeline.coverage === "full-history" ? "ok" : "neutral"}
              className="tracking-normal normal-case"
            >
              {coverageLabel}
            </Badge>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {extent ? (
            <>
              <WindowLengthPicker
                value={timeline.windowDays}
                onChange={(days) => setTimeline({ windowDays: days })}
              />
              <IconButton
                size="sm"
                tooltipSide="top"
                label={playing ? "Pause playback" : "Play history"}
                pressed={playing}
                icon={playing ? <Pause /> : <Play />}
                onClick={() => setPlaying(!playing)}
              />
              <IconButton
                size="sm"
                tooltipSide="top"
                label="Jump to latest"
                icon={<SkipForward />}
                disabled={timeline.cursor === null && !playing}
                onClick={() => {
                  setPlaying(false);
                  setTimeline({ cursor: null });
                }}
              />
            </>
          ) : null}
          <IconButton
            size="sm"
            tooltipSide="top"
            label="Close timeline"
            icon={<X />}
            onClick={close}
          />
        </div>
      </div>

      {extent && cursor !== null && stats ? (
        <>
          <div className="mt-2.5">
            <TimelineHistogram
              bars={bars}
              ticks={ticks}
              extent={extent}
              cursor={cursor}
              isLatest={timeline.cursor === null}
              windowStart={stats.start}
              windowLabel={`the ${windowOption?.description ?? `${timeline.windowDays} days`} up to that date`}
              onCursorChange={(value) => {
                setPlaying(false);
                setTimeline({ cursor: value });
              }}
            />
          </div>
          <WindowSummary
            index={index}
            stats={stats}
            announce={!playing}
            onSelectFile={(id) => select({ kind: "file", id }, { focus: true })}
          />
        </>
      ) : (
        <EmptyHistory
          message={
            graph.analysis.warnings.find((warning) => warning.code === "HISTORY_UNAVAILABLE")
              ?.message
          }
        />
      )}
    </section>
  );
}

function WindowSummary({
  index,
  stats,
  announce,
  onSelectFile,
}: {
  index: GraphIndex;
  stats: WindowStats;
  /** Live-announce changes (off during playback to avoid flooding screen readers). */
  announce: boolean;
  onSelectFile: (fileId: string) => void;
}) {
  const note =
    stats.historyCoverage === "none"
      ? "Outside the fetched commit history."
      : stats.historyCoverage === "partial"
        ? "Only part of this window is covered by the fetched commits."
        : stats.basis === "activity"
          ? "Files counted from last-modified dates (commit file lists unavailable)."
          : stats.commitsWithDetails < stats.commits
            ? `Files from ${formatInteger(stats.commitsWithDetails)} of ${pluralize(stats.commits, "commit")} with file details.`
            : null;

  return (
    <div className="mt-1.5 space-y-1.5">
      <p
        aria-live={announce ? "polite" : "off"}
        aria-atomic="true"
        className="text-ink-muted flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs"
      >
        <span className="text-ink font-mono">{formatWindowRange(stats.start, stats.end)}</span>
        <span>
          <span className="text-ink font-mono tabular-nums">{formatInteger(stats.commits)}</span>{" "}
          {stats.commits === 1 ? "commit" : "commits"}
        </span>
        <span>
          <span className="text-ink font-mono tabular-nums">
            {formatInteger(stats.filesChanged)}
          </span>{" "}
          {stats.filesChanged === 1 ? "file changed" : "files changed"}
        </span>
        <span>
          <span className="text-ink font-mono tabular-nums">
            {formatInteger(stats.contributors)}
          </span>{" "}
          {stats.contributors === 1 ? "contributor" : "contributors"}
        </span>
        {note ? <span className="text-ink-subtle text-[11px]">{note}</span> : null}
      </p>
      {stats.topFiles.length > 0 ? (
        <ul aria-label="Most changed files in this window" className="flex flex-wrap gap-1.5">
          {stats.topFiles.map(({ fileId, changes }) => {
            const file = index.filesById.get(fileId);
            if (!file) return null;
            return (
              <li key={fileId}>
                <button
                  type="button"
                  onClick={() => onSelectFile(fileId)}
                  title={escapeHiddenCharacters(file.path)}
                  className="border-line-strong bg-panel-raised/50 text-ink-muted hover:border-signal/40 hover:text-ink flex max-w-[13rem] items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
                >
                  <LanguageDot language={file.language} />
                  <span className="truncate font-mono">{revealHiddenCharacters(file.name)}</span>
                  {changes > 1 ? (
                    <span className="text-ink-subtle font-mono">×{changes}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyHistory({ message }: { message?: string }) {
  return (
    <div className="py-4 text-center">
      <p className="text-ink text-sm">No commit history is available for this analysis.</p>
      <p className="text-ink-subtle mt-1 text-xs">
        {message ?? "The repository has no readable commits, or history could not be fetched."}
      </p>
    </div>
  );
}
