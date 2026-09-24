// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { CameraControlsBar } from "./camera-controls-bar";
import { CoverageBadge } from "./coverage-badge";
import { HudStack, WorldHud } from "./explorer-hud";
import { dismissExplorerHint, FirstVisitHint, HINT_STORAGE_KEY } from "./first-visit-hint";
import { FocusBreadcrumb } from "./focus-breadcrumb";
import { SelectionAnnouncer } from "./selection-announcer";
import { fileRef, loadMockGraph, selectNode } from "./test-utils";
import { safeExternalUrl, TopBar } from "./top-bar";

const state = () => useExplorerStore.getState();

beforeEach(() => {
  loadMockGraph();
});

afterEach(() => {
  cleanup();
});

describe("TopBar", () => {
  it("links the repository safely and shows the analysed commit", () => {
    render(<TopBar worldEnabled />);
    const repoLink = screen.getByRole("link", { name: /codeverse-demo\/acme-platform on GitHub/ });
    expect(repoLink).toHaveAttribute("href", "https://github.com/codeverse-demo/acme-platform");
    expect(repoLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(repoLink).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "CodeVerse home" })).toHaveAttribute("href", "/");
    expect(
      screen.getByText(`@${mockRepositoryGraph.repository.commitSha.slice(0, 7)}`),
    ).toBeInTheDocument();
  });

  it("switches modes through an accessible segmented control", async () => {
    const user = userEvent.setup();
    render(<TopBar worldEnabled />);
    const group = screen.getByRole("group", { name: "Visual mode" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(within(group).getByRole("button", { name: "Architecture mode (1)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(group).getByRole("button", { name: "Complexity mode (5)" }));
    expect(state().visualMode).toBe("complexity");
    expect(within(group).getByRole("button", { name: "Complexity mode (5)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles tools and opens overlays", async () => {
    const user = userEvent.setup();
    render(<TopBar worldEnabled />);
    await user.click(screen.getByRole("button", { name: "Dependency lines (L)" }));
    expect(state().showDependencies).toBe(true);
    expect(screen.getByRole("button", { name: "Dependency lines (L)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // One static name; the pressed state (not the label) says which mode is on.
    const exploreToggle = screen.getByRole("button", { name: "Explore mode (G)" });
    expect(exploreToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(exploreToggle);
    expect(state().navigationMode).toBe("explore");
    expect(screen.getByRole("button", { name: "Explore mode (G)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "History timeline (T)" }));
    expect(state().timeline.active).toBe(true);
    await user.click(screen.getByRole("button", { name: "Repository statistics (I)" }));
    expect(state().panels.analytics).toBe(true);
    await user.click(screen.getByRole("button", { name: "Contributors" }));
    expect(state().panels.contributors).toBe(true);
    await user.click(screen.getByRole("button", { name: "Text summary" }));
    expect(state().panels.summary).toBe(true);
    await user.click(screen.getByRole("button", { name: "Share this view" }));
    expect(state().panels.share).toBe(true);
    await user.click(screen.getByRole("button", { name: "Search files and symbols (/)" }));
    expect(state().panels.search).toBe(true);
  });

  it("hides 3D-only controls without a world", () => {
    render(<TopBar worldEnabled={false} />);
    expect(screen.queryByRole("group", { name: "Visual mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dependency lines (L)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repository statistics (I)" })).toBeInTheDocument();
  });

  it("only links http(s) repository URLs", () => {
    expect(safeExternalUrl("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
  });

  it("names a pinned commit next to the repository, noting it may belong to no branch", () => {
    render(<TopBar worldEnabled />);
    expect(screen.queryByRole("link", { name: /Viewing commit/ })).not.toBeInTheDocument();
    cleanup();

    const sha = "0123456789abcdef0123456789abcdef01234567";
    loadMockGraph({
      ...mockRepositoryGraph,
      repository: { ...mockRepositoryGraph.repository, ref: sha, commitSha: sha },
    });
    render(<TopBar worldEnabled />);
    const notice = screen.getByRole("link", {
      name: "Viewing commit 0123456 on GitHub (opens in a new tab)",
    });
    expect(notice).toHaveTextContent("Viewing commit 0123456");
    expect(notice).toHaveAttribute(
      "href",
      `https://github.com/codeverse-demo/acme-platform/tree/${sha}`,
    );
    expect(notice).toHaveAttribute(
      "title",
      expect.stringContaining("may not belong to any branch of this repository"),
    );
    expect(notice).toHaveAccessibleDescription(
      expect.stringContaining("may not belong to any branch of this repository"),
    );
    // The commit is not repeated in the details row.
    expect(screen.queryByText("@0123456")).not.toBeInTheDocument();
  });

  it("reveals hidden characters in the repository name", () => {
    const repository = {
      ...mockRepositoryGraph.repository,
      name: "acme\u202Eplatform",
      fullName: "codeverse-demo/acme\u202Eplatform",
    };
    loadMockGraph({ ...mockRepositoryGraph, repository });
    render(<TopBar worldEnabled />);
    const link = screen.getByRole("link", {
      name: "codeverse-demo/acme[U+202E]platform on GitHub (opens in a new tab)",
    });
    expect(link).toHaveTextContent("codeverse-demo/acmeU+202Eplatform");
    expect(link.querySelector('[data-hidden-character="U+202E"]')).not.toBeNull();
  });
});

describe("CameraControlsBar", () => {
  it("issues camera commands and disables focus without a selection", async () => {
    const user = userEvent.setup();
    render(<CameraControlsBar />);
    expect(screen.getByRole("button", { name: "Focus selected (F)" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reset camera (R)" }));
    expect(state().cameraCommand).toMatchObject({ type: "reset" });
    await user.click(screen.getByRole("button", { name: "Frame whole repository (H)" }));
    expect(state().cameraCommand).toMatchObject({ type: "focus-repository" });
    act(() => selectNode(fileRef("src/index.ts")));
    await user.click(screen.getByRole("button", { name: "Focus selected (F)" }));
    expect(state().cameraCommand).toMatchObject({ type: "focus-selected" });
  });
});

describe("CoverageBadge", () => {
  it("summarizes coverage and reveals details in a popover that Escape closes", async () => {
    const user = userEvent.setup();
    const limited: RepositoryGraph = {
      ...mockRepositoryGraph,
      analysis: {
        ...mockRepositoryGraph.analysis,
        tier: "directory-first",
        treeTruncated: true,
        warnings: [
          {
            code: "LARGE_REPOSITORY",
            message: "Very large repository: only a sample of files was parsed.",
          },
        ],
      },
    };
    loadMockGraph(limited);
    selectNode(fileRef("src/index.ts"));
    render(<CoverageBadge />);
    const toggle = screen.getByRole("button", { name: /Parsed \d+ of \d+\+ files/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    const details = screen.getByRole("region", { name: "Analysis coverage" });
    expect(within(details).getByText("Structure-first analysis")).toBeInTheDocument();
    expect(
      within(details).getByText("Very large repository: only a sample of files was parsed."),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Analysis coverage" })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    // Escape closed only the popover.
    expect(state().selection).not.toBeNull();
  });

  it("says calmly when an earlier analysis is shown because GitHub could not confirm the latest commit", async () => {
    const user = userEvent.setup();
    const detail = "GitHub could not be reached, so CodeVerse could not check for newer commits.";
    loadMockGraph({
      ...mockRepositoryGraph,
      analysis: {
        ...mockRepositoryGraph.analysis,
        warnings: [{ code: "STALE_ANALYSIS", message: detail }],
      },
    });
    render(<HudStack perfOpen={false} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(
      /^Showing the last analysis from .+ — GitHub couldn't confirm the latest commit$/,
    );

    await user.click(screen.getByRole("button", { name: /Parsed \d+ of \d+ files/ }));
    const details = screen.getByRole("region", { name: "Analysis coverage" });
    expect(within(details).getByText(/^Showing the last analysis from/)).toBeInTheDocument();
    // Explained once, with the freshness notice: it is not a coverage gap.
    expect(within(details).getAllByText(detail)).toHaveLength(1);
    expect(within(details).getByText(detail).closest("li")).toBeNull();
  });

  it("shows no freshness notice for a current analysis", () => {
    render(<HudStack perfOpen={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("FocusBreadcrumb", () => {
  it("shows the focused path and navigates up and out", async () => {
    const user = userEvent.setup();
    act(() => state().focusDirectory("dir:src/api/handlers"));
    render(<FocusBreadcrumb />);
    const nav = screen.getByRole("navigation", { name: "Focused directory" });
    expect(within(nav).getByText("handlers")).toHaveAttribute("aria-current", "location");
    await user.click(within(nav).getByRole("button", { name: "api" }));
    expect(state().focusedDirectoryId).toBe("dir:src/api");
    await user.click(within(nav).getByRole("button", { name: "Up one directory (Backspace)" }));
    expect(state().focusedDirectoryId).toBe("dir:src");
    await user.click(screen.getByRole("button", { name: "Exit directory" }));
    expect(state().focusedDirectoryId).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Focused directory" })).not.toBeInTheDocument();
  });

  it("reveals hidden characters in directory names", () => {
    loadMockGraph({
      ...mockRepositoryGraph,
      directories: mockRepositoryGraph.directories.map((directory) =>
        directory.path === "src/api" ? { ...directory, name: "a\u202Epi" } : directory,
      ),
    });
    act(() => state().focusDirectory("dir:src/api/handlers"));
    render(<FocusBreadcrumb />);
    const nav = screen.getByRole("navigation", { name: "Focused directory" });
    const crumb = within(nav).getByRole("button", { name: "aU+202Epi" });
    expect(crumb.querySelector('[data-hidden-character="U+202E"]')).not.toBeNull();
  });
});

// Before the FirstVisitHint tests: dismissing the hint lasts for the whole session (module state).
describe("WorldHud", () => {
  it("hides the first-visit hint on narrow screens while a selection is shown", () => {
    window.localStorage.removeItem(HINT_STORAGE_KEY);
    render(<WorldHud />);
    const slot = () => screen.getByRole("note", { name: "How to navigate" }).parentElement;
    expect(slot()).not.toHaveClass("max-md:hidden");
    act(() => selectNode(fileRef("src/index.ts")));
    expect(slot()).toHaveClass("max-md:hidden");
    act(() => selectNode(null));
    expect(slot()).not.toHaveClass("max-md:hidden");
  });
});

describe("FirstVisitHint", () => {
  it("shows once and remembers dismissal", async () => {
    window.localStorage.removeItem(HINT_STORAGE_KEY);
    const user = userEvent.setup();
    const { unmount } = render(<FirstVisitHint />);
    expect(screen.getByRole("note", { name: "How to navigate" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss navigation hint" }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(HINT_STORAGE_KEY)).toBe("1");
    unmount();
    render(<FirstVisitHint />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("still hides for the session when storage throws", () => {
    const setItem = window.localStorage.setItem.bind(window.localStorage);
    Object.defineProperty(window.localStorage, "setItem", {
      configurable: true,
      value: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    try {
      expect(() => dismissExplorerHint()).not.toThrow();
      render(<FirstVisitHint />);
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window.localStorage, "setItem", { configurable: true, value: setItem });
    }
  });
});

describe("SelectionAnnouncer", () => {
  it("announces selection, focus and mode changes in polite live regions", () => {
    render(<SelectionAnnouncer />);
    act(() => selectNode(fileRef("src/auth/auth.ts")));
    expect(
      screen.getByText("Selected file src/auth/auth.ts, TypeScript, 842 lines"),
    ).toBeInTheDocument();
    act(() => state().focusDirectory("dir:src/auth"));
    expect(screen.getByText("Inside directory src/auth")).toBeInTheDocument();
    act(() => state().setVisualMode("activity"));
    expect(screen.getByText("Activity mode")).toHaveAttribute("aria-live", "polite");
  });
});
