// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { RepositorySummary } from "./repository-summary";

const githubGraph: RepositoryGraph = {
  ...mockRepositoryGraph,
  repository: {
    ...mockRepositoryGraph.repository,
    provider: "github",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
  },
};

function load(graph: RepositoryGraph = githubGraph) {
  act(() => useExplorerStore.getState().loadGraph(graph));
}

function treeItem(name: RegExp | string) {
  return within(screen.getByRole("tree")).getByRole("treeitem", { name });
}

beforeEach(() => useExplorerStore.getState().reset());
afterEach(() => cleanup());

describe("RepositorySummary", () => {
  it("renders nothing as an overlay until opened", () => {
    load();
    const { container } = render(<RepositorySummary />);
    expect(container).toBeEmptyDOMElement();
    act(() => useExplorerStore.getState().setPanel("summary", true));
    expect(
      screen.getByRole("dialog", { name: "codeverse-demo/acme-platform" }),
    ).toBeInTheDocument();
  });

  it("renders standalone page content with a heading, stats, languages and coverage", () => {
    load();
    act(() => useExplorerStore.getState().setWebglAvailable(false));
    render(<RepositorySummary standalone />);
    expect(
      screen.getByRole("heading", { level: 1, name: "codeverse-demo/acme-platform" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("WebGL");
    expect(screen.getByRole("region", { name: "Languages" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Analysis coverage" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders only top-level nodes until directories are expanded", () => {
    load();
    render(<RepositorySummary standalone />);
    const tree = screen.getByRole("tree");
    const items = within(tree).getAllByRole("treeitem");
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.getAttribute("aria-level") === "1")).toBe(true);
    // Roving tabindex: exactly one tab stop.
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
  });

  it("supports the tree keyboard pattern", async () => {
    const user = userEvent.setup();
    load();
    render(<RepositorySummary standalone />);
    const docs = treeItem(/^docs,/);
    docs.focus();

    await user.keyboard("{ArrowDown}");
    expect(treeItem(/^packages,/)).toHaveFocus();

    await user.keyboard("{End}");
    expect(treeItem("tsconfig.json")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(treeItem(/^docs,/)).toHaveFocus();

    // Type-ahead to "src", expand it with Right, enter it with Right again.
    await user.keyboard("sss");
    const src = treeItem(/^src,/);
    expect(src).toHaveFocus();
    expect(src).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowRight}");
    expect(src).toHaveAttribute("aria-expanded", "true");
    expect(within(src).getByRole("group")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    const api = treeItem(/^api,/);
    expect(api).toHaveFocus();
    expect(api).toHaveAttribute("aria-level", "2");
    expect(api.tabIndex).toBe(0);
    expect(src.tabIndex).toBe(-1);

    // Left climbs to the parent, then collapses it.
    await user.keyboard("{ArrowLeft}");
    expect(src).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(
      within(screen.getByRole("tree")).queryByRole("treeitem", { name: /^api,/ }),
    ).not.toBeInTheDocument();
  });

  it("selects a file with Enter and shows its details", async () => {
    const user = userEvent.setup();
    load();
    render(<RepositorySummary standalone />);
    treeItem(/^src,/).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{ArrowRight}");
    // src/ -> api/ -> auth/ (expanded); first child auth.ts
    await user.keyboard("{ArrowRight}");
    expect(treeItem("auth.ts")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useExplorerStore.getState().selection).toEqual({
      kind: "file",
      id: "file:src/auth/auth.ts",
    });
    expect(treeItem("auth.ts")).toHaveAttribute("aria-selected", "true");

    const details = screen.getByRole("complementary", { name: "Selection details" });
    expect(within(details).getByRole("heading", { name: "src/auth/auth.ts" })).toBeInTheDocument();
    expect(within(details).getByRole("region", { name: /^Symbols/ })).toHaveTextContent(
      "AuthService",
    );
    expect(within(details).getByRole("region", { name: /^Imported by/ })).toHaveTextContent(
      "src/auth/middleware.ts",
    );
    expect(within(details).getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute(
      "href",
      `https://github.com/codeverse-demo/acme-platform/blob/${githubGraph.repository.commitSha}/src/auth/auth.ts`,
    );

    await user.click(within(details).getByRole("button", { name: /View source/ }));
    expect(useExplorerStore.getState().codeViewer).toEqual({ fileId: "file:src/auth/auth.ts" });
  });

  it("reveals a dependency in the tree when navigating from the details", async () => {
    const user = userEvent.setup();
    load();
    act(() => useExplorerStore.getState().select({ kind: "file", id: "file:src/index.ts" }));
    render(<RepositorySummary standalone />);
    const details = screen.getByRole("complementary", { name: "Selection details" });
    await user.click(within(details).getByRole("button", { name: /src\/api\/routes\.ts/ }));
    expect(useExplorerStore.getState().selection).toEqual({
      kind: "file",
      id: "file:src/api/routes.ts",
    });
    const routes = treeItem("routes.ts");
    expect(routes).toHaveAttribute("aria-selected", "true");
    expect(routes).toHaveAttribute("aria-level", "3");
    expect(routes.tabIndex).toBe(0);
  });

  it("toggles directories by click and shows directory details", async () => {
    const user = userEvent.setup();
    load();
    render(<RepositorySummary standalone />);
    await user.click(within(treeItem(/^docs,/)).getByText("docs"));
    expect(treeItem(/^docs,/)).toHaveAttribute("aria-expanded", "true");
    expect(useExplorerStore.getState().selection).toEqual({ kind: "directory", id: "dir:docs" });
    const details = screen.getByRole("complementary", { name: "Selection details" });
    expect(within(details).getByRole("heading", { name: "docs/" })).toBeInTheDocument();
  });

  it("closes the overlay with Escape unless the source viewer is open", async () => {
    const user = userEvent.setup();
    load();
    act(() => useExplorerStore.getState().setPanel("summary", true));
    render(<RepositorySummary />);
    act(() => useExplorerStore.getState().openCodeViewer({ fileId: "file:src/auth/auth.ts" }));
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().panels.summary).toBe(true);
    act(() => useExplorerStore.getState().closeCodeViewer());
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().panels.summary).toBe(false);
  });
});
