// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { AnalyticsPanel } from "./analytics-panel";
import { ContributorsPanel } from "./contributors-panel";

function load(graph: RepositoryGraph = mockRepositoryGraph) {
  act(() => useExplorerStore.getState().loadGraph(graph));
}

function openPanel(panel: "analytics" | "contributors") {
  act(() => useExplorerStore.getState().setPanel(panel, true));
}

beforeEach(() => useExplorerStore.getState().reset());
afterEach(() => cleanup());

describe("AnalyticsPanel", () => {
  it("renders nothing while closed", () => {
    load();
    const { container } = render(<AnalyticsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows repository numbers, languages, packages and coverage", () => {
    load();
    openPanel("analytics");
    render(<AnalyticsPanel />);
    const panel = screen.getByRole("complementary", { name: "Repository statistics" });
    expect(within(panel).getByText("codeverse-demo/acme-platform")).toBeInTheDocument();
    expect(within(panel).getByText("1.3K")).toBeInTheDocument(); // 1,284 stars, compact
    expect(within(panel).getByText("TypeScript")).toBeInTheDocument();
    expect(within(panel).getAllByText("parsed").length).toBeGreaterThan(0);
    expect(within(panel).getByText("vitest")).toBeInTheDocument();
    expect(within(panel).getByText("Full analysis")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Parse coverage" })).toBeInTheDocument();
  });

  it("selects and focuses a file from the largest-files list", async () => {
    const user = userEvent.setup();
    load();
    openPanel("analytics");
    render(<AnalyticsPanel />);
    const largest = screen.getByRole("region", { name: "Largest files" });
    await user.click(within(largest).getByRole("button", { name: /^auth\.ts/ }));
    const state = useExplorerStore.getState();
    expect(state.selection).toEqual({ kind: "file", id: "file:src/auth/auth.ts" });
    expect(state.cameraCommand).toMatchObject({ type: "focus-node" });
  });

  it("lists analysis warnings and closes", async () => {
    const user = userEvent.setup();
    load({
      ...mockRepositoryGraph,
      analysis: {
        ...mockRepositoryGraph.analysis,
        tier: "progressive",
        warnings: [
          { code: "PARSE_LIMIT", message: "Only the 1,500 most important files were parsed." },
        ],
      },
    });
    openPanel("analytics");
    render(<AnalyticsPanel />);
    expect(screen.getByRole("list", { name: "Analysis warnings" })).toHaveTextContent(
      "Only the 1,500 most important files were parsed.",
    );
    expect(screen.getByText("Progressive")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(useExplorerStore.getState().panels.analytics).toBe(false);
  });
});

describe("ContributorsPanel", () => {
  it("activates a contributor, switching to contributors mode and showing details", async () => {
    const user = userEvent.setup();
    load();
    openPanel("contributors");
    render(<ContributorsPanel />);
    const list = screen.getByRole("list", { name: "Contributors" });
    expect(within(list).getAllByRole("button")).toHaveLength(4);

    await user.click(within(list).getByRole("button", { name: /Ada Octo/ }));
    const state = useExplorerStore.getState();
    expect(state.activeContributorId).toBe("user:octo-ada");
    expect(state.visualMode).toBe("contributors");

    const detail = screen.getByRole("region", { name: "Contributor details: Ada Octo" });
    expect(within(detail).getByRole("link", { name: /Ada Octo/ })).toHaveAttribute(
      "href",
      "https://github.com/octo-ada",
    );
    expect(within(detail).getByText("Files touched")).toBeInTheDocument();
    expect(within(detail).getByText(/based on the latest 16 commits/)).toBeInTheDocument();
    expect(within(detail).getByText("Harden JWT verification")).toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: /src\/auth\// }));
    expect(useExplorerStore.getState().focusedDirectoryId).toBe("dir:src/auth");

    await user.click(within(detail).getByRole("button", { name: "Clear" }));
    expect(useExplorerStore.getState().activeContributorId).toBeNull();
    expect(screen.queryByRole("region", { name: /Contributor details/ })).not.toBeInTheDocument();
  });

  it("renders CDN avatars as images and everything else as initials", () => {
    const graph: RepositoryGraph = {
      ...mockRepositoryGraph,
      contributors: [
        {
          ...mockRepositoryGraph.contributors[0]!,
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        },
        { ...mockRepositoryGraph.contributors[1]!, avatarUrl: "https://tracker.example/pixel.png" },
      ],
    };
    load(graph);
    openPanel("contributors");
    render(<ContributorsPanel />);
    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toMatch(
      /^https:\/\/avatars\.githubusercontent\.com\/u\/1\?v=4&s=\d+$/,
    );
    expect(images[0]).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(images[0]).toHaveAttribute("alt", "Ada Octo");
    expect(screen.getByRole("img", { name: "Bruno Octo" })).toHaveTextContent("BO");
  });

  it("keeps only one left-docked panel open (last opened wins)", () => {
    load();
    openPanel("analytics");
    render(
      <>
        <AnalyticsPanel />
        <ContributorsPanel />
      </>,
    );
    expect(
      screen.getByRole("complementary", { name: "Repository statistics" }),
    ).toBeInTheDocument();
    act(() => useExplorerStore.getState().setVisualMode("contributors"));
    expect(useExplorerStore.getState().panels.analytics).toBe(false);
    expect(
      screen.queryByRole("complementary", { name: "Repository statistics" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Contributors" })).toBeInTheDocument();
  });

  it("lists contributors without files in the analysed window last, muted, and explains an empty highlight", async () => {
    const user = userEvent.setup();
    const [ada] = mockRepositoryGraph.contributors;
    if (!ada) throw new Error("fixture has contributors");
    const founder = {
      ...ada,
      id: "user:founder",
      name: "Founder Person",
      login: "founder",
      contributions: 3_600,
      commitCount: 0,
      fileIds: [],
    };
    const bot = {
      ...founder,
      id: "user:bot",
      name: "renovate[bot]",
      login: "renovate[bot]",
      commitCount: 2,
    };
    load({
      ...mockRepositoryGraph,
      contributors: [founder, bot, ...mockRepositoryGraph.contributors],
    });
    openPanel("contributors");
    render(<ContributorsPanel />);

    // The founder has the most all-time contributions but touched nothing in the window.
    const withFiles = screen.getByRole("list", { name: "Contributors" });
    expect(within(withFiles).getAllByRole("button")[0]).toHaveAccessibleName(/Ada Octo/);
    expect(within(withFiles).queryByRole("button", { name: /Founder/ })).not.toBeInTheDocument();
    const quiet = screen.getByRole("list", { name: "No files touched in the analysed window" });
    expect(
      within(quiet)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("renovate[bot]"),
      expect.stringContaining("Founder Person"),
    ]);

    await user.click(within(quiet).getByRole("button", { name: /Founder Person/ }));
    const detail = screen.getByRole("region", { name: "Contributor details: Founder Person" });
    expect(
      within(detail).getByText(
        "No files touched in the analysed window, so no files are highlighted.",
      ),
    ).toBeInTheDocument();
    expect(within(detail).queryByText("Most active areas")).not.toBeInTheDocument();

    await user.click(within(quiet).getByRole("button", { name: /renovate/ }));
    expect(
      within(screen.getByRole("region", { name: /Contributor details/ })).getByText(
        "None of their commits in the analysed window has file details, so no files are highlighted.",
      ),
    ).toBeInTheDocument();
  });

  it("explains when there is no contributor data", () => {
    load({ ...mockRepositoryGraph, contributors: [] });
    openPanel("contributors");
    render(<ContributorsPanel />);
    expect(screen.getByText("No contributor data.")).toBeInTheDocument();
  });
});
