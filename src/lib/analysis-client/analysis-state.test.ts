import { describe, expect, it } from "vitest";
import { ANALYSIS_STAGES, ERROR_COPY, type AnalysisEvent } from "@/analysis/protocol";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  activeStage,
  analysisReducer,
  createInitialSnapshot,
  finishedStageCount,
  MAX_STREAM_WARNINGS,
  type AnalysisSnapshot,
} from "./analysis-state";

function apply(events: Array<[AnalysisEvent, number]>, state: AnalysisSnapshot = createInitialSnapshot()): AnalysisSnapshot {
  return events.reduce((current, [event, at]) => analysisReducer(current, { type: "event", event, at }), state);
}

describe("analysisReducer", () => {
  it("starts with every stage pending", () => {
    const state = createInitialSnapshot();
    expect(state.status).toBe("loading");
    expect(ANALYSIS_STAGES.every((id) => state.stages[id].status === "pending")).toBe(true);
    expect(activeStage(state.stages)).toBeNull();
  });

  it("tracks stage lifecycle with timestamps, progress and messages", () => {
    const state = apply([
      [{ type: "stage", stage: "connect", status: "start" }, 5],
      [{ type: "stage", stage: "connect", status: "done", message: "Repository found" }, 120],
      [{ type: "stage", stage: "parse", status: "start", message: "Parsing 1,500 files" }, 200],
      [{ type: "stage", stage: "parse", status: "progress", progress: 0.4 }, 900],
    ]);
    expect(state.stages.connect).toEqual({ status: "done", startedAt: 5, finishedAt: 120, progress: 1, message: "Repository found" });
    expect(state.stages.parse).toMatchObject({ status: "progress", progress: 0.4, startedAt: 200, message: "Parsing 1,500 files" });
    expect(state.stages.parse.finishedAt).toBeUndefined();
    expect(activeStage(state.stages)).toBe("parse");
    expect(finishedStageCount(state.stages)).toBe(1);
    expect(state.elapsedMs).toBe(900);
  });

  it("collects de-duplicated warnings from warning events", () => {
    const warning = (message: string): [AnalysisEvent, number] => [{ type: "stage", stage: "tree", status: "warning", message }, 1];
    const state = apply([warning("Large repository"), warning("Large repository"), warning("Tree truncated")]);
    expect(state.warnings).toEqual(["Large repository", "Tree truncated"]);
    expect(state.stages.tree.status).toBe("warning");

    const many = apply(Array.from({ length: MAX_STREAM_WARNINGS + 5 }, (_, index) => warning(`w${index}`)));
    expect(many.warnings).toHaveLength(MAX_STREAM_WARNINGS);
    expect(many.warnings.at(-1)).toBe(`w${MAX_STREAM_WARNINGS + 4}`);
  });

  it("moves through preview to complete and settles running stages", () => {
    const state = apply([
      [{ type: "stage", stage: "construct", status: "start" }, 10],
      [{ type: "preview", graph: mockRepositoryGraph }, 20],
    ]);
    expect(state.status).toBe("preview");
    expect(state.graph).toBe(mockRepositoryGraph);
    const done = apply([[{ type: "complete", graph: mockRepositoryGraph }, 50]], state);
    expect(done.status).toBe("complete");
    expect(done.stages.construct).toMatchObject({ status: "done", finishedAt: 50 });
    expect(done.stages.history.status).toBe("pending");
  });

  it("treats complete and error as terminal", () => {
    const failed = analysisReducer(createInitialSnapshot(), {
      type: "event",
      event: { type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } },
      at: 30,
    });
    expect(failed.status).toBe("error");
    expect(analysisReducer(failed, { type: "event", event: { type: "complete", graph: mockRepositoryGraph }, at: 40 })).toBe(failed);
    expect(analysisReducer(failed, { type: "tick", at: 5_000 })).toBe(failed);

    const complete = apply([[{ type: "complete", graph: mockRepositoryGraph }, 10]]);
    const afterFail = analysisReducer(complete, { type: "fail", error: { code: "INTERNAL", ...ERROR_COPY.INTERNAL }, at: 20 });
    expect(afterFail).toBe(complete);
  });

  it("advances elapsed time monotonically and skips no-op ticks", () => {
    const state = analysisReducer(createInitialSnapshot(), { type: "tick", at: 300 });
    expect(state.elapsedMs).toBe(300);
    expect(analysisReducer(state, { type: "tick", at: 200 })).toBe(state);
    expect(analysisReducer(state, { type: "event", event: { type: "heartbeat" }, at: 250 })).toBe(state);
  });
});
