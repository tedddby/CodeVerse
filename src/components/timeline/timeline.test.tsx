// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { Timeline } from "./timeline";
import { DAY_MS } from "./timeline-model";

const REFERENCE = Date.parse("2026-09-01T00:00:00.000Z");

function activate(graph: RepositoryGraph = mockRepositoryGraph) {
  act(() => {
    useExplorerStore.getState().loadGraph(graph);
    useExplorerStore.getState().setTimeline({ active: true });
  });
}

beforeEach(() => useExplorerStore.getState().reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Timeline", () => {
  it("renders nothing while inactive", () => {
    act(() => useExplorerStore.getState().loadGraph(mockRepositoryGraph));
    const { container } = render(<Timeline />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels sampled coverage honestly and shows the latest window", () => {
    activate();
    render(<Timeline />);
    const bar = screen.getByRole("region", { name: "History timeline" });
    expect(within(bar).getByText("Based on the latest 16 commits")).toBeInTheDocument();
    const slider = within(bar).getByRole("slider", { name: "Timeline position" });
    expect(slider.getAttribute("aria-valuetext")).toMatch(
      /\(latest\), showing the 30 days up to that date$/,
    );
    const summary = bar.querySelector("p[aria-live]");
    expect(summary?.textContent).toMatch(/\d+ commits\d+ files changed\d+ contributors?/);
    expect(
      within(bar).getByRole("list", { name: "Most changed files in this window" }),
    ).toBeInTheDocument();
  });

  it("moves the cursor with the slider and snaps back to latest at the end", () => {
    activate();
    render(<Timeline />);
    const slider = screen.getByRole("slider", { name: "Timeline position" });
    const max = Number(slider.getAttribute("max"));
    expect(slider).toHaveValue(String(max));

    // Ten steps (days) back from the end.
    fireEvent.change(slider, { target: { value: String(max - 10) } });
    const cursor = useExplorerStore.getState().timeline.cursor;
    expect(cursor).not.toBeNull();
    expect(slider).toHaveValue(String(max - 10));
    expect(slider.getAttribute("aria-valuetext")).not.toMatch(/latest/);

    fireEvent.change(slider, { target: { value: String(max - 9) } });
    expect((useExplorerStore.getState().timeline.cursor ?? 0) - (cursor ?? 0)).toBe(DAY_MS);

    fireEvent.change(slider, { target: { value: String(max) } });
    expect(useExplorerStore.getState().timeline.cursor).toBeNull();
  });

  it("changes the window length and jumps back to latest", async () => {
    const user = userEvent.setup();
    activate();
    render(<Timeline />);
    await user.click(screen.getByRole("radio", { name: "90 days" }));
    expect(useExplorerStore.getState().timeline.windowDays).toBe(90);
    expect(screen.getByRole("radio", { name: "90 days" })).toHaveAttribute("aria-checked", "true");

    act(() => useExplorerStore.getState().setTimeline({ cursor: REFERENCE - 50 * DAY_MS }));
    await user.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(useExplorerStore.getState().timeline.cursor).toBeNull();
  });

  it("selects and focuses a changed file", async () => {
    const user = userEvent.setup();
    activate();
    render(<Timeline />);
    const list = screen.getByRole("list", { name: "Most changed files in this window" });
    const [first] = within(list).getAllByRole("button");
    expect(first).toBeDefined();
    if (first) await user.click(first);
    expect(useExplorerStore.getState().selection?.kind).toBe("file");
    expect(useExplorerStore.getState().cameraCommand?.type).toBe("focus-node");
  });

  it("plays history in discrete steps with reduced motion and never autoplays", () => {
    vi.useFakeTimers();
    activate();
    act(() => useExplorerStore.getState().setReducedMotion(true));
    render(<Timeline />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(useExplorerStore.getState().timeline.cursor).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play history" }));
    const start = useExplorerStore.getState().timeline.cursor;
    expect(start).not.toBeNull();
    act(() => vi.advanceTimersByTime(900));
    const next = useExplorerStore.getState().timeline.cursor;
    expect(next).not.toBeNull();
    expect(next ?? 0).toBeGreaterThan(start ?? 0);

    fireEvent.click(screen.getByRole("button", { name: "Pause playback" }));
    const paused = useExplorerStore.getState().timeline.cursor;
    act(() => vi.advanceTimersByTime(5_000));
    expect(useExplorerStore.getState().timeline.cursor).toBe(paused);
  });

  it("finishes playback at the latest commit", () => {
    vi.useFakeTimers();
    activate();
    act(() => useExplorerStore.getState().setReducedMotion(true));
    render(<Timeline />);
    fireEvent.click(screen.getByRole("button", { name: "Play history" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(useExplorerStore.getState().timeline.cursor).toBeNull();
    expect(screen.getByRole("button", { name: "Play history" })).toBeInTheDocument();
  });

  it("shows an informative empty state and closes", async () => {
    const user = userEvent.setup();
    activate({
      ...mockRepositoryGraph,
      commits: [],
      timeline: { granularity: "week", coverage: "sampled", buckets: [] },
      analysis: {
        ...mockRepositoryGraph.analysis,
        warnings: [
          { code: "HISTORY_UNAVAILABLE", message: "GitHub did not return commit history." },
        ],
      },
    });
    render(<Timeline />);
    expect(
      screen.getByText("No commit history is available for this analysis."),
    ).toBeInTheDocument();
    expect(screen.getByText("GitHub did not return commit history.")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close timeline" }));
    expect(useExplorerStore.getState().timeline.active).toBe(false);
  });
});
