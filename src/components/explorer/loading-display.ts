import { ANALYSIS_STAGES, STAGE_LABELS, type AnalysisStageId } from "@/analysis/protocol";
import {
  activeStage,
  finishedStageCount,
  type AnalysisStatus,
  type StageProgress,
} from "@/lib/analysis-client/analysis-state";

/**
 * Pure presentation logic for the loading experience ("mission control").
 * Kept separate from the component so the copy and state mapping are testable.
 */

export const BLOCK_BAR_WIDTH = 15;

/** "██████████░░░░░" for 0..1 (clamped; NaN renders empty). */
export function renderBlockBar(progress: number, width: number = BLOCK_BAR_WIDTH): string {
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** "00:12.4" (minutes:seconds.tenths), or "1:02:03.4" past an hour. */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const tenths = Math.floor(safe / 100) % 10;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export type StageTone = "pending" | "running" | "done" | "skipped" | "warning";

export interface StageRowModel {
  id: AnalysisStageId;
  /** "Parsing source..." */
  label: string;
  tone: StageTone;
  /** Result or activity text shown next to the label. */
  detail: string;
  /** 0..1 when a progress bar should be drawn. */
  progress: number | null;
  /** Seconds the stage took, once finished. */
  durationLabel: string | null;
}

function durationLabel(stage: StageProgress): string | null {
  if (stage.startedAt === undefined || stage.finishedAt === undefined) return null;
  const seconds = Math.max(0, stage.finishedAt - stage.startedAt) / 1000;
  return seconds < 0.05 ? null : `${seconds.toFixed(1)}s`;
}

export interface StageRowContext {
  status: AnalysisStatus;
  /** Analysis finished but the 3D layout is still being computed on the client. */
  layoutPending: boolean;
}

export function buildStageRow(
  id: AnalysisStageId,
  stage: StageProgress,
  context: StageRowContext,
): StageRowModel {
  const label = `${STAGE_LABELS[id]}...`;
  const base = { id, label, durationLabel: durationLabel(stage) };

  if (id === "construct" && context.status === "complete") {
    return context.layoutPending
      ? {
          ...base,
          tone: "running",
          detail: "Laying out districts",
          progress: null,
          durationLabel: null,
        }
      : { ...base, tone: "done", detail: "Complete", progress: null };
  }

  switch (stage.status) {
    case "pending":
      return { ...base, tone: "pending", detail: "", progress: null };
    case "start":
      return {
        ...base,
        tone: "running",
        detail: stage.message ?? "",
        progress: stage.progress ?? null,
      };
    case "progress":
      return {
        ...base,
        tone: "running",
        detail: stage.message ?? "",
        progress: stage.progress ?? null,
      };
    case "done":
      return { ...base, tone: "done", detail: stage.message ?? "Done", progress: null };
    case "skipped":
      return { ...base, tone: "skipped", detail: stage.message ?? "Skipped", progress: null };
    case "warning":
      return {
        ...base,
        tone: "warning",
        detail: stage.message ?? "Completed with warnings",
        progress: null,
      };
  }
}

export function buildStageRows(
  stages: Record<AnalysisStageId, StageProgress>,
  context: StageRowContext,
): StageRowModel[] {
  return ANALYSIS_STAGES.map((id) => buildStageRow(id, stages[id], context));
}

/**
 * Concise status for the polite live region. Changes only on stage
 * transitions (never on percentage ticks) so screen readers are not flooded.
 */
export function loadingAnnouncement(
  fullName: string,
  stages: Record<AnalysisStageId, StageProgress>,
  context: StageRowContext,
): string {
  if (context.status === "complete") {
    return context.layoutPending
      ? `Analysis of ${fullName} complete. Constructing the 3D universe.`
      : `${fullName} is ready. Entering the explorer.`;
  }
  const active = activeStage(stages);
  const finished = finishedStageCount(stages);
  const total = ANALYSIS_STAGES.length;
  if (!active) return `Analyzing ${fullName}. ${finished} of ${total} steps finished.`;
  return `Analyzing ${fullName}: ${STAGE_LABELS[active]}. ${finished} of ${total} steps finished.`;
}

export const LOADING_TIPS: readonly string[] = [
  "Every building is a file. Its height is its lines of code.",
  "Press / anywhere in the explorer to search files and symbols.",
  "G switches between Orbit and first-person Explore mode.",
  "Large repositories are analysed progressively: structure first, then a prioritized sample of source files.",
  "Press ? inside the explorer to see every keyboard shortcut.",
  "Dependency arcs connect files that import each other. Press L to toggle them.",
];

/** Rotates through tips every `intervalMs` of elapsed analysis time. */
export function tipForElapsed(elapsedMs: number, intervalMs = 7_000): string {
  const index = Math.floor(Math.max(0, elapsedMs) / intervalMs) % LOADING_TIPS.length;
  return LOADING_TIPS[index] ?? LOADING_TIPS[0] ?? "";
}
