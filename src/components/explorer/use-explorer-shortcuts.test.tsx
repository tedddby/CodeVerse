// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "@/state/explorer-store";
import { directoryRef, fileRef, loadMockGraph, selectNode, symbolRef } from "./test-utils";
import { CANVAS_ATTRIBUTE, useExplorerShortcuts, type ExplorerShortcutOptions } from "./use-explorer-shortcuts";

const onTogglePerf = vi.fn();

function setup(options: Partial<ExplorerShortcutOptions> = {}) {
  return renderHook(() => useExplorerShortcuts({ enabled: true, worldEnabled: true, onTogglePerf, ...options }));
}

function press(key: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body) {
  return fireEvent.keyDown(target, { key, ...init });
}

const state = () => useExplorerStore.getState();

beforeEach(() => {
  loadMockGraph();
  onTogglePerf.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useExplorerShortcuts", () => {
  it("switches visual modes with 1–5 and ignores other digits", () => {
    setup();
    press("2");
    expect(state().visualMode).toBe("dependencies");
    press("5");
    expect(state().visualMode).toBe("complexity");
    press("9");
    expect(state().visualMode).toBe("complexity");
  });

  it("ignores keys while typing in a field or with modifier keys held", () => {
    setup();
    const { getByRole } = render(<input aria-label="field" />);
    const input = getByRole("textbox");
    input.focus();
    press("3", {}, input);
    expect(state().visualMode).toBe("architecture");
    press("3", { ctrlKey: true });
    press("3", { metaKey: true });
    press("3", { altKey: true });
    expect(state().visualMode).toBe("architecture");
  });

  it("leaves keys to composite widgets such as trees, except Escape", () => {
    setup();
    state().setPanel("summary", true);
    const { getByRole } = render(
      <ul role="tree" aria-label="Files">
        <li role="treeitem" aria-selected="false" tabIndex={0}>
          src
        </li>
      </ul>,
    );
    const item = getByRole("treeitem");
    press("t", {}, item);
    press("2", {}, item);
    expect(state().timeline.active).toBe(false);
    expect(state().visualMode).toBe("architecture");
    press("Escape", {}, item);
    expect(state().panels.summary).toBe(false);
  });

  it("ignores auto-repeat and events already handled elsewhere", () => {
    setup();
    press("l", { repeat: true });
    expect(state().showDependencies).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "l", bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(state().showDependencies).toBe(false);
  });

  it("opens search and toggles the shortcuts overlay", () => {
    setup();
    const event = press("/");
    expect(event).toBe(false); // default prevented, so "/" is not typed into the palette
    expect(state().panels.search).toBe(true);
    state().setPanel("search", false);
    press("?");
    expect(state().panels.shortcuts).toBe(true);
  });

  it("does nothing but let overlays handle keys while a blocking overlay is open", () => {
    setup();
    state().setPanel("search", true);
    press("4");
    press("Escape");
    expect(state().visualMode).toBe("architecture");
    expect(state().panels.search).toBe(true);
    state().setPanel("search", false);
    state().openCodeViewer({ fileId: "file:src/index.ts" });
    press("t");
    expect(state().timeline.active).toBe(false);
  });

  it("cascades Escape: overlay, then selection, then focused directory", () => {
    setup();
    state().focusDirectory("dir:src/auth");
    selectNode(fileRef("src/auth/auth.ts"));
    state().setPanel("analytics", true);

    press("Escape");
    expect(state().panels.analytics).toBe(false);
    expect(state().selection).not.toBeNull();
    press("Escape");
    expect(state().selection).toBeNull();
    expect(state().focusedDirectoryId).toBe("dir:src/auth");
    press("Escape");
    expect(state().focusedDirectoryId).toBeNull();
    expect(press("Escape")).toBe(true); // nothing left: not consumed
  });

  it("goes up one directory with Backspace and enters the selected directory with Enter", () => {
    setup();
    state().focusDirectory("dir:src/api/handlers");
    press("Backspace");
    expect(state().focusedDirectoryId).toBe("dir:src/api");
    press("Backspace");
    expect(state().focusedDirectoryId).toBe("dir:src");
    press("Backspace");
    expect(state().focusedDirectoryId).toBeNull();

    selectNode(directoryRef("src/payments"));
    press("Enter");
    expect(state().focusedDirectoryId).toBe("dir:src/payments");
  });

  it("leaves Enter to focused buttons", () => {
    setup();
    const { getByRole } = render(<button type="button">Act</button>);
    selectNode(directoryRef("src/payments"));
    press("Enter", {}, getByRole("button"));
    expect(state().focusedDirectoryId).toBeNull();
  });

  it("opens the code viewer for the selected file or symbol with V", () => {
    setup();
    selectNode(fileRef("src/lib/db.ts"));
    press("v");
    expect(state().codeViewer).toEqual({ fileId: "file:src/lib/db.ts" });
    state().closeCodeViewer();
    selectNode(symbolRef("src/lib/db.ts", "transaction", 94));
    press("V");
    expect(state().codeViewer).toEqual({ fileId: "file:src/lib/db.ts", line: 94, endLine: 190 });
    state().closeCodeViewer();
    selectNode(fileRef("docs/diagrams/overview.png"));
    press("v");
    expect(state().codeViewer).toBeNull();
  });

  it("issues camera commands and toggles panels, lines and the timeline", () => {
    setup();
    press("r");
    expect(state().cameraCommand).toMatchObject({ type: "reset" });
    press("h");
    expect(state().cameraCommand).toMatchObject({ type: "focus-repository" });
    press("f");
    expect(state().cameraCommand).toMatchObject({ type: "focus-repository" }); // no selection: ignored
    selectNode(fileRef("src/index.ts"));
    press("f");
    expect(state().cameraCommand).toMatchObject({ type: "focus-selected" });
    press("l");
    expect(state().showDependencies).toBe(true);
    press("i");
    expect(state().panels.analytics).toBe(true);
    press("t");
    expect(state().timeline.active).toBe(true);
    expect(state().visualMode).toBe("activity"); // the timeline highlights through Activity mode
    press("t");
    expect(state().timeline.active).toBe(false);
    expect(state().visualMode).toBe("architecture");
    press("`");
    expect(onTogglePerf).toHaveBeenCalledTimes(1);
  });

  it("never takes over Tab, so focus can always move past the canvas", () => {
    setup();
    const { container } = render(<div {...{ [CANVAS_ATTRIBUTE]: "" }} tabIndex={0} data-testid="canvas" />);
    const canvas = container.firstElementChild as HTMLElement;

    // fireEvent returns false only when the default action was prevented.
    expect(press("Tab")).toBe(true);
    expect(press("Tab", {}, canvas)).toBe(true);
    expect(press("Tab", { shiftKey: true }, canvas)).toBe(true);
    fireEvent.pointerDown(canvas);
    expect(press("Tab")).toBe(true);
    expect(press("Tab", {}, canvas)).toBe(true);
    expect(state().navigationMode).toBe("orbit");
  });

  it("switches between Orbit and Explore mode with G, from the canvas or the page", () => {
    setup();
    const { container } = render(<div {...{ [CANVAS_ATTRIBUTE]: "" }} tabIndex={0} />);
    const canvas = container.firstElementChild as HTMLElement;
    expect(press("g", {}, canvas)).toBe(false);
    expect(state().navigationMode).toBe("explore");
    expect(press("G", { shiftKey: true })).toBe(false);
    expect(state().navigationMode).toBe("orbit");
  });

  it("disables world-only keys when the 3D view is unavailable", () => {
    setup({ worldEnabled: false });
    press("3");
    press("r");
    press("`");
    press("g");
    expect(state().navigationMode).toBe("orbit");
    expect(state().visualMode).toBe("architecture");
    expect(state().cameraCommand).toBeNull();
    expect(onTogglePerf).not.toHaveBeenCalled();
    press("/");
    expect(state().panels.search).toBe(true);
  });

  it("does not listen while disabled and stops listening on unmount", () => {
    const { rerender, unmount } = renderHook((props: { enabled: boolean }) =>
      useExplorerShortcuts({ enabled: props.enabled, worldEnabled: true }), { initialProps: { enabled: false } });
    press("2");
    expect(state().visualMode).toBe("architecture");
    rerender({ enabled: true });
    press("2");
    expect(state().visualMode).toBe("dependencies");
    unmount();
    press("3");
    expect(state().visualMode).toBe("dependencies");
  });
});
