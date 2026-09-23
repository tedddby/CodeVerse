// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS } from "@/lib/shortcuts";
import { useExplorerStore } from "@/state/explorer-store";
import { groupShortcuts, ShortcutsOverlay } from "./shortcuts-overlay";

beforeEach(() => useExplorerStore.getState().reset());
afterEach(() => cleanup());

describe("ShortcutsOverlay", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<ShortcutsOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every shortcut grouped, with key caps", () => {
    act(() => useExplorerStore.getState().setPanel("shortcuts", true));
    render(<ShortcutsOverlay />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const group of ["Navigation", "Selection", "View", "Panels"]) {
      expect(within(dialog).getByRole("region", { name: group })).toBeInTheDocument();
    }
    const navigation = within(dialog).getByRole("region", { name: "Navigation" });
    const move = within(navigation).getByText("Move (Explore mode)").closest("div");
    expect(Array.from(move?.querySelectorAll("kbd") ?? []).map((kbd) => kbd.textContent)).toEqual([
      "W",
      "A",
      "S",
      "D",
    ]);
    // Pointer gestures are labels, not key caps.
    expect(within(navigation).getByText("Drag").tagName).not.toBe("KBD");
    const actions = Array.from(dialog.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(actions).toEqual(
      expect.arrayContaining(KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.action)),
    );
    expect(actions).toHaveLength(KEYBOARD_SHORTCUTS.length);
  });

  it("closes with Escape and restores focus", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    act(() => useExplorerStore.getState().setPanel("shortcuts", true));
    render(<ShortcutsOverlay />);
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().panels.shortcuts).toBe(false);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("groups shortcuts in a stable order", () => {
    expect(groupShortcuts(KEYBOARD_SHORTCUTS).map((entry) => entry.group)).toEqual([
      "Navigation",
      "Selection",
      "View",
      "Panels",
    ]);
    expect(groupShortcuts([{ keys: ["X"], action: "x", group: "View" }])).toEqual([
      { group: "View", items: [{ keys: ["X"], action: "x", group: "View" }] },
    ]);
  });
});
