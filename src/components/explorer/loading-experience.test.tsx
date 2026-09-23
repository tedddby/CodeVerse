// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisStageId } from "@/analysis/protocol";
import { createInitialStages, type StageProgress } from "@/lib/analysis-client/analysis-state";
import { buildStageRow, formatElapsed, loadingAnnouncement, renderBlockBar, tipForElapsed, LOADING_TIPS } from "./loading-display";
import { LoadingExperience } from "./loading-experience";

afterEach(() => cleanup());

function stagesWith(patch: Partial<Record<AnalysisStageId, StageProgress>>) {
  return { ...createInitialStages(), ...patch };
}

const midwayStages = stagesWith({
  connect: { status: "done", message: "Repository found", startedAt: 0, finishedAt: 300 },
  tree: { status: "done", message: "3,281 files", startedAt: 300, finishedAt: 1_500 },
  languages: { status: "done", message: "TypeScript 62%", startedAt: 1_500, finishedAt: 1_600 },
  parse: { status: "progress", progress: 0.71, startedAt: 1_600 },
  dependencies: { status: "progress", progress: 0.89, message: "Resolving imports", startedAt: 2_000 },
});

describe("LoadingExperience", () => {
  it("renders the mission-control stage list with results and block progress bars", () => {
    render(
      <LoadingExperience
        owner="vercel"
        repo="next.js"
        status="loading"
        stages={midwayStages}
        warnings={[]}
        elapsedMs={12_400}
        layoutPending={false}
      />,
    );
    expect(screen.getByRole("heading", { name: "vercel/next.js" })).toBeInTheDocument();
    expect(screen.getByText("T+00:12.4")).toBeInTheDocument();
    for (const label of ["Connecting to GitHub...", "Fetching file tree...", "Parsing source...", "Building dependency graph...", "Constructing universe..."]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Repository found")).toBeInTheDocument();
    expect(screen.getByText("3,281 files")).toBeInTheDocument();
    expect(screen.getByText("TypeScript 62%")).toBeInTheDocument();
    expect(screen.getByText("███████████░░░░")).toBeInTheDocument();
    expect(screen.getByText("█████████████░░")).toBeInTheDocument();
    expect(screen.getByText("71%", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Resolving imports")).toBeInTheDocument();
    expect(screen.getByText("1.2s")).toBeInTheDocument(); // tree stage duration
  });

  it("announces stage transitions politely without per-percent chatter", () => {
    render(
      <LoadingExperience owner="vercel" repo="next.js" status="loading" stages={midwayStages} warnings={[]} elapsedMs={0} layoutPending={false} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Analyzing vercel/next.js: Building dependency graph. 3 of 8 steps finished.");
  });

  it("shows warnings as they arrive", () => {
    render(
      <LoadingExperience
        owner="torvalds"
        repo="linux"
        status="preview"
        stages={midwayStages}
        warnings={["Large repository: showing structure first and parsing a sample of 1,500 files."]}
        elapsedMs={0}
        layoutPending={false}
      />,
    );
    const log = screen.getByRole("log", { name: "Analysis notices" });
    expect(within(log).getByText(/Large repository/)).toBeInTheDocument();
  });

  it("shows the client-side layout step, then completion", () => {
    const { rerender } = render(
      <LoadingExperience owner="a" repo="b" status="complete" stages={midwayStages} warnings={[]} elapsedMs={9_000} layoutPending />,
    );
    expect(screen.getByText("Laying out districts")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Analysis of a/b complete. Constructing the 3D universe.");
    rerender(<LoadingExperience owner="a" repo="b" status="complete" stages={midwayStages} warnings={[]} elapsedMs={9_000} layoutPending={false} exiting />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("a/b is ready. Entering the explorer.");
  });

  it("offers a way out while loading", () => {
    render(<LoadingExperience owner="a" repo="b" gitRef="v2.0.0" status="loading" stages={createInitialStages()} warnings={[]} elapsedMs={0} layoutPending={false} />);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/");
    expect(screen.getByText("ref v2.0.0")).toBeInTheDocument();
  });
});

describe("loading display helpers", () => {
  it("renders block bars, clamping out-of-range input", () => {
    expect(renderBlockBar(0)).toBe("░".repeat(15));
    expect(renderBlockBar(1)).toBe("█".repeat(15));
    expect(renderBlockBar(0.5, 10)).toBe("█████░░░░░");
    expect(renderBlockBar(4)).toBe("█".repeat(15));
    expect(renderBlockBar(Number.NaN)).toBe("░".repeat(15));
  });

  it("formats elapsed time as mm:ss.t and h:mm:ss.t", () => {
    expect(formatElapsed(0)).toBe("00:00.0");
    expect(formatElapsed(65_430)).toBe("01:05.4");
    expect(formatElapsed(3_723_400)).toBe("1:02:03.4");
    expect(formatElapsed(-5)).toBe("00:00.0");
  });

  it("maps stage states to row models", () => {
    const context = { status: "loading", layoutPending: false } as const;
    expect(buildStageRow("connect", { status: "pending" }, context)).toMatchObject({ tone: "pending", detail: "", progress: null });
    expect(buildStageRow("history", { status: "skipped" }, context)).toMatchObject({ tone: "skipped", detail: "Skipped" });
    expect(buildStageRow("tree", { status: "warning", message: "Tree truncated" }, context)).toMatchObject({ tone: "warning", detail: "Tree truncated" });
    expect(buildStageRow("parse", { status: "start" }, context)).toMatchObject({ tone: "running", progress: null });
  });

  it("rotates tips deterministically", () => {
    expect(tipForElapsed(0)).toBe(LOADING_TIPS[0]);
    expect(tipForElapsed(7_000)).toBe(LOADING_TIPS[1]);
    expect(tipForElapsed(7_000 * LOADING_TIPS.length)).toBe(LOADING_TIPS[0]);
  });

  it("announces the start of an analysis before any stage reports", () => {
    expect(loadingAnnouncement("a/b", createInitialStages(), { status: "loading", layoutPending: false })).toBe(
      "Analyzing a/b. 0 of 8 steps finished.",
    );
  });
});
