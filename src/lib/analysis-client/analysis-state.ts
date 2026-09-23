import {
  ANALYSIS_STAGES,
  type AnalysisErrorPayload,
  type AnalysisEvent,
  type AnalysisStageId,
  type StageStatus,
} from "@/analysis/protocol";
import type { RepositoryGraph } from "@/graph/model/types";

/**
 * Pure state machine behind `useRepositoryAnalysis`.
 *
 *   loading ──preview──▶ preview ──complete──▶ complete
 *      │                    │
 *      └──────error─────────┴──────────────▶ error
 *
 * `complete` and `error` are terminal: later events and ticks are ignored, so
 * a late event can never resurrect a finished analysis.
 * All timestamps are milliseconds since the analysis request started.
 */

export type AnalysisStatus = "loading" | "preview" | "complete" | "error";

export interface StageProgress {
  status: StageStatus | "pending";
  /** 0..1, for stages reporting incremental progress. */
  progress?: number;
  /** Latest result line reported by the server, e.g. "3,281 files". */
  message?: string;
  /** Ms since the request started when the stage first reported. */
  startedAt?: number;
  /** Ms since the request started when the stage finished (done/skipped/warning). */
  finishedAt?: number;
}

export interface AnalysisSnapshot {
  status: AnalysisStatus;
  stages: Record<AnalysisStageId, StageProgress>;
  /** User-facing warnings reported while streaming, in arrival order, de-duplicated. */
  warnings: string[];
  /** The preview graph while status is "preview", the final graph once "complete". */
  graph: RepositoryGraph | null;
  error: AnalysisErrorPayload | null;
  /** Ms since the request started; frozen once the analysis finishes. */
  elapsedMs: number;
}

export type AnalysisAction =
  | { type: "event"; event: AnalysisEvent; at: number }
  | { type: "fail"; error: AnalysisErrorPayload; at: number }
  | { type: "tick"; at: number };

/** Warnings kept for display; the rest are summarized by the coverage report. */
export const MAX_STREAM_WARNINGS = 12;

export function createInitialStages(): Record<AnalysisStageId, StageProgress> {
  const stages = {} as Record<AnalysisStageId, StageProgress>;
  for (const id of ANALYSIS_STAGES) stages[id] = { status: "pending" };
  return stages;
}

export function createInitialSnapshot(): AnalysisSnapshot {
  return { status: "loading", stages: createInitialStages(), warnings: [], graph: null, error: null, elapsedMs: 0 };
}

export function isTerminalStatus(status: AnalysisStatus): boolean {
  return status === "complete" || status === "error";
}

function applyStage(
  current: StageProgress,
  status: StageStatus,
  at: number,
  progress: number | undefined,
  message: string | undefined,
): StageProgress {
  const next: StageProgress = {
    ...current,
    status,
    startedAt: current.startedAt ?? at,
    message: message ?? current.message,
  };
  switch (status) {
    case "start":
      next.progress = progress;
      next.finishedAt = undefined;
      break;
    case "progress":
      next.progress = progress ?? current.progress;
      next.finishedAt = undefined;
      break;
    case "done":
      next.progress = 1;
      next.finishedAt = at;
      break;
    case "skipped":
    case "warning":
      next.finishedAt = current.finishedAt ?? at;
      break;
  }
  return next;
}

/** Marks stages that were still running when the analysis completed as done. */
function settleRunningStages(stages: Record<AnalysisStageId, StageProgress>, at: number) {
  const settled = { ...stages };
  for (const id of ANALYSIS_STAGES) {
    const stage = settled[id];
    if (stage.status === "start" || stage.status === "progress") {
      settled[id] = { ...stage, status: "done", progress: 1, finishedAt: at };
    }
  }
  return settled;
}

export function analysisReducer(state: AnalysisSnapshot, action: AnalysisAction): AnalysisSnapshot {
  if (isTerminalStatus(state.status)) return state;
  const elapsedMs = Math.max(state.elapsedMs, action.at);

  if (action.type === "tick") return elapsedMs === state.elapsedMs ? state : { ...state, elapsedMs };
  if (action.type === "fail") return { ...state, status: "error", error: action.error, elapsedMs };

  const event = action.event;
  switch (event.type) {
    case "stage": {
      const stages = {
        ...state.stages,
        [event.stage]: applyStage(state.stages[event.stage], event.status, action.at, event.progress, event.message),
      };
      let warnings = state.warnings;
      if (event.status === "warning" && event.message && !warnings.includes(event.message)) {
        warnings = [...warnings, event.message].slice(-MAX_STREAM_WARNINGS);
      }
      return { ...state, stages, warnings, elapsedMs };
    }
    case "preview":
      return { ...state, status: "preview", graph: event.graph, elapsedMs };
    case "complete":
      return {
        ...state,
        status: "complete",
        graph: event.graph,
        stages: settleRunningStages(state.stages, action.at),
        elapsedMs,
      };
    case "error":
      return { ...state, status: "error", error: event.error, elapsedMs };
    case "heartbeat":
      return elapsedMs === state.elapsedMs ? state : { ...state, elapsedMs };
  }
}

/** The stage currently in progress (the latest one that started and has not finished), if any. */
export function activeStage(stages: Record<AnalysisStageId, StageProgress>): AnalysisStageId | null {
  let active: AnalysisStageId | null = null;
  for (const id of ANALYSIS_STAGES) {
    const status = stages[id].status;
    if (status === "start" || status === "progress") active = id;
  }
  return active;
}

/** Number of stages that reached a final state (done, skipped or warning). */
export function finishedStageCount(stages: Record<AnalysisStageId, StageProgress>): number {
  return ANALYSIS_STAGES.filter((id) => {
    const status = stages[id].status;
    return status === "done" || status === "skipped" || status === "warning";
  }).length;
}
