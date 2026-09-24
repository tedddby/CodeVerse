// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { SelectionPanel } from "./selection-panel";
import { CANVAS_ATTRIBUTE } from "./use-explorer-shortcuts";
import { directoryRef, fileRef, loadMockGraph, selectNode, symbolRef } from "./test-utils";

const SHA = mockRepositoryGraph.repository.commitSha;

beforeEach(() => {
  // Freeze "now" at the fixture's reference date so relative times are stable.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-01T00:00:00.000Z") });
  loadMockGraph();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function panel() {
  return screen.getByRole("complementary", { name: "Selection details" });
}

describe("SelectionPanel", () => {
  it("renders nothing without a selection", () => {
    const { container } = render(<SelectionPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("file", () => {
    beforeEach(() => selectNode(fileRef("src/auth/auth.ts")));

    it("summarizes the file with honest counts and activity", () => {
      render(<SelectionPanel />);
      const details = within(panel());
      expect(details.getByText("auth.ts")).toBeInTheDocument();
      expect(details.getByText("TypeScript · 842 lines")).toBeInTheDocument();
      expect(details.queryByText("estimated")).not.toBeInTheDocument();
      const stat = (label: string) => details.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
      expect(stat("Functions")).toBe("6");
      expect(stat("Classes")).toBe("1");
      expect(stat("Imports")).toBe("4");
      expect(stat("Dependents")).toBe("3");
      expect(details.getByText("Last modified").nextElementSibling?.textContent).toBe("7 months ago");
      expect(details.getByText("octo-ada")).toBeInTheDocument();
      // Parsed files carry no status warning.
      expect(details.queryByText("Metadata only")).not.toBeInTheDocument();
    });

    it("groups symbols by kind and selects a symbol with a camera flight", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SelectionPanel />);
      const details = within(panel());
      const groupLabels = details.getAllByText(/^(Classes|Interfaces|Functions|Methods)/, { selector: "p" });
      expect(groupLabels.map((label) => label.textContent)).toEqual(["Classes 1", "Interfaces 1", "Functions 2", "Methods 4"]);
      await user.click(details.getByRole("button", { name: "hashPassword" }));
      const state = useExplorerStore.getState();
      expect(state.selection).toEqual(symbolRef("src/auth/auth.ts", "hashPassword", 620));
      expect(state.cameraCommand).toMatchObject({ type: "focus-node", ref: symbolRef("src/auth/auth.ts", "hashPassword", 620) });
    });

    it("opens the code viewer at a symbol's line", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SelectionPanel />);
      await user.click(screen.getByRole("button", { name: "View source of revoke, lines 194–260" }));
      expect(useExplorerStore.getState().codeViewer).toEqual({ fileId: "file:src/auth/auth.ts", line: 194, endLine: 260 });
    });

    it("links resolved imports, dependents and breadcrumb directories", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SelectionPanel />);
      const details = within(panel());
      expect(details.getByRole("button", { name: "tests/auth.test.ts" })).toBeInTheDocument();
      await user.click(details.getByRole("button", { name: "src/auth/jwt.ts" }));
      expect(useExplorerStore.getState().selection).toEqual(fileRef("src/auth/jwt.ts"));

      act(() => selectNode(fileRef("src/auth/auth.ts")));
      await user.click(within(screen.getByRole("navigation", { name: "Path" })).getByRole("button", { name: "src" }));
      expect(useExplorerStore.getState().selection).toEqual(directoryRef("src"));
    });

    it("lists external imports and offers source, GitHub and dependency actions", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      selectNode(fileRef("src/auth/jwt.ts"));
      render(<SelectionPanel />);
      const details = within(panel());
      expect(details.getByText("jsonwebtoken")).toBeInTheDocument();
      expect(details.getByText("external")).toBeInTheDocument();

      const github = details.getByRole("link", { name: /Open on GitHub/ });
      expect(github).toHaveAttribute("href", `https://github.com/codeverse-demo/acme-platform/blob/${SHA}/src/auth/jwt.ts`);
      expect(github).toHaveAttribute("target", "_blank");
      expect(github).toHaveAttribute("rel", "noopener noreferrer");

      await user.click(details.getByRole("button", { name: "View source" }));
      expect(useExplorerStore.getState().codeViewer).toEqual({ fileId: "file:src/auth/jwt.ts" });

      await user.click(details.getByRole("button", { name: "Focus dependents" }));
      const state = useExplorerStore.getState();
      expect(state.visualMode).toBe("dependencies");
      expect(state.showDependencies).toBe(true);
      expect(state.dependencyDirection).toBe("incoming");
      expect(state.cameraCommand).toMatchObject({ type: "focus-node", ref: fileRef("src/auth/jwt.ts") });
      const framedDependents = state.cameraCommand?.type === "focus-node" ? (state.cameraCommand.include ?? []) : [];
      expect(framedDependents.map((ref) => ref.id).sort()).toEqual(
        ["src/api/handlers/auth.ts", "src/auth/auth.ts", "tests/auth.test.ts"].map((path) => fileRef(path).id),
      );
    });

    it("focuses the imports and the dependents separately", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      selectNode(fileRef("src/auth/jwt.ts"));
      render(<SelectionPanel />);
      await user.click(within(panel()).getByRole("button", { name: "Focus dependencies" }));
      const state = useExplorerStore.getState();
      expect(state.dependencyDirection).toBe("outgoing");
      // Only files in the graph are framed; the external "jsonwebtoken" import has no building.
      expect(state.cameraCommand).toMatchObject({
        type: "focus-node",
        ref: fileRef("src/auth/jwt.ts"),
        include: [fileRef("src/lib/config.ts"), fileRef("src/users/user.ts")],
      });
    });

    it("clears the selection when closed", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SelectionPanel />);
      await user.click(screen.getByRole("button", { name: "Close panel" }));
      expect(useExplorerStore.getState().selection).toBeNull();
    });
  });

  it("is honest about files that were not parsed", () => {
    selectNode(fileRef("docs/diagrams/overview.png"));
    render(<SelectionPanel />);
    const details = within(panel());
    expect(details.getByText("Binary")).toBeInTheDocument();
    expect(details.getByText("Binary files are never downloaded or parsed.")).toBeInTheDocument();
    expect(details.getByRole("button", { name: "View source" })).toBeDisabled();
  });

  it("shows the status reason and estimate badge for metadata-only files", () => {
    const graph: RepositoryGraph = {
      ...mockRepositoryGraph,
      files: mockRepositoryGraph.files.map((file) =>
        file.path === "src/users/service.ts"
          ? { ...file, status: "metadata-only", linesEstimated: true, statusReason: "Skipped: parse limit of 1,500 files reached." }
          : file,
      ),
    };
    loadMockGraph(graph);
    selectNode(fileRef("src/users/service.ts"));
    render(<SelectionPanel />);
    const details = within(panel());
    expect(details.getByText("Metadata only")).toBeInTheDocument();
    expect(details.getByText("Skipped: parse limit of 1,500 files reached.")).toBeInTheDocument();
    expect(details.getByText("estimated")).toBeInTheDocument();
  });

  it("describes a directory with sub-directories, languages and largest files", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    selectNode(directoryRef("src"));
    render(<SelectionPanel />);
    const details = within(panel());
    const src = mockRepositoryGraph.directories.find((directory) => directory.path === "src");
    expect(details.getByText(`${src?.stats.fileCount} files · ${src?.stats.totalLines.toLocaleString("en")} LOC`)).toBeInTheDocument();
    for (const name of ["auth", "payments", "users", "lib", "api"]) {
      expect(details.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(details.getByRole("img", { name: /TypeScript 100%/ })).toBeInTheDocument();
    const largest = within(details.getByText("Largest files").closest("section") as HTMLElement).getAllByRole("button");
    expect(largest[0]).toHaveTextContent("auth/auth.ts");
    expect(details.getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute(
      "href",
      `https://github.com/codeverse-demo/acme-platform/tree/${SHA}/src`,
    );

    await user.click(details.getByRole("button", { name: "Enter directory" }));
    expect(useExplorerStore.getState().focusedDirectoryId).toBe("dir:src");
  });

  it("keeps focus on Enter directory once it is inside the directory", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    selectNode(directoryRef("src/auth"));
    render(<SelectionPanel />);
    within(panel()).getByRole("button", { name: "Enter directory" }).focus();
    await user.keyboard("{Enter}");
    const inside = within(panel()).getByRole("button", { name: "Inside this directory" });
    expect(inside).toHaveAttribute("aria-disabled", "true");
    expect(inside).toHaveFocus();
    const command = useExplorerStore.getState().cameraCommand;
    await user.keyboard("{Enter}");
    expect(useExplorerStore.getState().cameraCommand).toBe(command); // inert while disabled
  });

  it("notes files omitted from a directory by analysis limits", () => {
    const graph: RepositoryGraph = {
      ...mockRepositoryGraph,
      directories: mockRepositoryGraph.directories.map((directory) =>
        directory.path === "src/lib" ? { ...directory, stats: { ...directory.stats, omittedFileCount: 12 } } : directory,
      ),
    };
    loadMockGraph(graph);
    selectNode(directoryRef("src/lib"));
    render(<SelectionPanel />);
    expect(screen.getByText(/12 files in this directory were not included in the 3D world/)).toBeInTheDocument();
  });

  it("describes the repository root by the repository name", () => {
    selectNode({ kind: "directory", id: "dir:" });
    render(<SelectionPanel />);
    expect(within(panel()).getByText("Repository root")).toBeInTheDocument();
    expect(within(panel()).getByText("acme-platform")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Enter directory" })).toBeDisabled();
  });

  describe("keyboard focus", () => {
    function renderWithCanvas() {
      return render(
        <>
          <div {...{ [CANVAS_ATTRIBUTE]: "" }} tabIndex={0} aria-label="3D map" />
          <SelectionPanel />
        </>,
      );
    }

    it("names the panel with a heading for the selected node", () => {
      selectNode(fileRef("src/auth/jwt.ts"));
      render(<SelectionPanel />);
      expect(within(panel()).getByRole("heading", { level: 2, name: "jwt.ts" })).toBeInTheDocument();
    });

    it("moves focus to the new panel's title after navigating from inside the panel", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      selectNode(fileRef("src/auth/jwt.ts"));
      renderWithCanvas();
      within(screen.getByRole("navigation", { name: "Path" })).getByRole("button", { name: "auth" }).focus();
      await user.keyboard("{Enter}");
      expect(useExplorerStore.getState().selection).toEqual(directoryRef("src/auth"));
      expect(within(panel()).getByRole("heading", { level: 2, name: "auth" })).toHaveFocus();

      // Tab continues inside the new panel.
      await user.tab();
      expect(panel()).toContainElement(document.activeElement as HTMLElement);
    });

    it("leaves focus alone when the selection changes from outside the panel", () => {
      selectNode(fileRef("src/auth/jwt.ts"));
      const { container } = renderWithCanvas();
      const canvas = container.querySelector<HTMLElement>(`[${CANVAS_ATTRIBUTE}]`);
      canvas?.focus();
      act(() => selectNode(fileRef("src/auth/auth.ts")));
      expect(canvas).toHaveFocus();
    });

    it("returns focus to the 3D map when the panel closes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      selectNode(fileRef("src/auth/jwt.ts"));
      const { container } = renderWithCanvas();
      within(panel()).getByRole("button", { name: "Close panel" }).focus();
      await user.keyboard("{Enter}");
      expect(useExplorerStore.getState().selection).toBeNull();
      expect(container.querySelector(`[${CANVAS_ATTRIBUTE}]`)).toHaveFocus();
    });
  });

  it("describes a symbol with its file, range, signature and members", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    selectNode(symbolRef("src/auth/auth.ts", "AuthService", 30));
    render(<SelectionPanel />);
    const details = within(panel());
    expect(details.getByText("lines 30–610")).toBeInTheDocument();
    expect(details.getByText("class AuthService")).toBeInTheDocument();
    expect(details.getByText("exported")).toBeInTheDocument();
    const members = within(details.getByText("Members").closest("section") as HTMLElement);
    expect(members.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "authenticate",
      "refresh",
      "revoke",
      "verifyPassword",
    ]);
    expect(details.getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute(
      "href",
      `https://github.com/codeverse-demo/acme-platform/blob/${SHA}/src/auth/auth.ts#L30-L610`,
    );
    await user.click(details.getByRole("button", { name: "View source" }));
    expect(useExplorerStore.getState().codeViewer).toEqual({ fileId: "file:src/auth/auth.ts", line: 30, endLine: 610 });
    await user.click(details.getByRole("button", { name: "Select file" }));
    expect(useExplorerStore.getState().selection).toEqual(fileRef("src/auth/auth.ts"));
  });
});
