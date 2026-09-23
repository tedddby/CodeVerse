// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { useExplorerStore } from "@/state/explorer-store";
import { SearchPalette } from "./search-palette";
import { cycleFilter, groupResults, moveActive } from "./search-palette-model";
import { splitByMatches } from "./highlighted-text";

function openPalette() {
  act(() => {
    useExplorerStore.getState().loadGraph(mockRepositoryGraph);
    useExplorerStore.getState().setPanel("search", true);
  });
}

function options() {
  return within(screen.getByRole("listbox")).queryAllByRole("option");
}

function activeOption() {
  return options().find((option) => option.getAttribute("aria-selected") === "true");
}

beforeEach(() => {
  useExplorerStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe("SearchPalette", () => {
  it("renders nothing while closed", () => {
    act(() => useExplorerStore.getState().loadGraph(mockRepositoryGraph));
    const { container } = render(<SearchPalette />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as a labelled dialog with a focused input and suggestions", () => {
    openPalette();
    render(<SearchPalette />);
    expect(screen.getByRole("dialog", { name: "Search repository" })).toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "Search repository" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("placeholder", "Search repository...");
    expect(screen.getByText("Most-connected files")).toBeInTheDocument();
    expect(screen.getByText("Largest directories")).toBeInTheDocument();
    expect(options().length).toBeGreaterThan(0);
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
  });

  it("navigates with the arrow keys (wrapping) and selects with Enter", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    const input = screen.getByRole("combobox");
    await user.type(input, "auth");

    const first = options()[0];
    expect(first).toHaveTextContent("auth/");
    expect(activeOption()).toBe(first);

    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toBe(options()[1]);
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(activeOption()).toBe(options()[options().length - 1]);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOption()).toBe(options()[1]);
    const expectedTitle = options()[1]?.textContent ?? "";
    expect(expectedTitle).toContain("auth.ts");

    await user.keyboard("{Enter}");
    const state = useExplorerStore.getState();
    expect(state.selection).toEqual({ kind: "file", id: "file:src/auth/auth.ts" });
    expect(state.cameraCommand).toMatchObject({
      type: "focus-node",
      ref: { kind: "file", id: "file:src/auth/auth.ts" },
    });
    expect(state.panels.search).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("highlights matched characters in titles", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    await user.type(screen.getByRole("combobox"), "ccs");
    const marks = options()[0]?.querySelectorAll("mark");
    expect(options()[0]).toHaveTextContent("createCheckoutSession()");
    expect(Array.from(marks ?? []).map((mark) => mark.textContent)).toEqual(["c", "C", "S"]);
  });

  it("cycles filters with Tab and Shift+Tab without losing input focus", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    const input = screen.getByRole("combobox");
    await user.type(input, "auth");

    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
    expect(options().every((option) => option.textContent?.includes("File"))).toBe(true);
    expect(options().some((option) => option.textContent?.includes("Directory"))).toBe(false);

    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Directories" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining("auth/"),
    ]);

    await user.keyboard("{Shift>}{Tab}{Tab}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "Symbols" })).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
    expect(options().length).toBeGreaterThan(0);
    expect(options()[0]?.textContent).toMatch(/^auth/i);
    expect(options().some((option) => /, (File|Directory)/.test(option.textContent ?? ""))).toBe(
      false,
    );
    expect(options().some((option) => option.textContent?.includes("authenticate()"))).toBe(true);
  });

  it("selects a result on click", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    await user.type(screen.getByRole("combobox"), "StripeGateway");
    const option = options().find((item) => item.textContent?.includes("StripeGateway"));
    expect(option).toBeDefined();
    if (option) await user.click(option);
    expect(useExplorerStore.getState().selection?.kind).toBe("symbol");
    expect(useExplorerStore.getState().panels.search).toBe(false);
  });

  it("opens the source at the symbol with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    await user.type(screen.getByRole("combobox"), "verifyPassword");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(useExplorerStore.getState().codeViewer).toEqual({
      fileId: "file:src/auth/auth.ts",
      line: 264,
      endLine: 330,
    });
  });

  it("shows an empty state and closes with Escape", async () => {
    const user = userEvent.setup();
    openPalette();
    render(<SearchPalette />);
    await user.type(screen.getByRole("combobox"), "zzqqxx");
    expect(options()).toHaveLength(0);
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(useExplorerStore.getState().selection).toBeNull();
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().panels.search).toBe(false);
  });
});

describe("search palette model", () => {
  it("cycles filters in both directions", () => {
    expect(cycleFilter("all", 1)).toBe("file");
    expect(cycleFilter("symbol", 1)).toBe("all");
    expect(cycleFilter("all", -1)).toBe("symbol");
  });

  it("wraps the active index and handles empty lists", () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });

  it("groups by kind in order of each group's best result", () => {
    const make = (kind: "file" | "directory" | "symbol", id: string) => ({
      ref: { kind, id },
      kind,
      title: id,
      subtitle: "",
      score: 0,
      matches: [],
    });
    const { groups, ordered } = groupResults([
      make("symbol", "a"),
      make("file", "b"),
      make("symbol", "c"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["symbol", "file"]);
    expect(ordered.map((result) => result.title)).toEqual(["a", "c", "b"]);
    expect(groups[0]?.items.map((item) => item.index)).toEqual([0, 1]);
    expect(groups[1]?.items.map((item) => item.index)).toEqual([2]);
  });

  it("splits text into matched and unmatched runs", () => {
    expect(splitByMatches("AuthService", [0, 4, 5])).toEqual([
      { text: "A", matched: true },
      { text: "uth", matched: false },
      { text: "Se", matched: true },
      { text: "rvice", matched: false },
    ]);
    expect(splitByMatches("abc", [])).toEqual([{ text: "abc", matched: false }]);
  });
});
