"use client";

import { useEffect } from "react";
import { ROOT_DIRECTORY_ID } from "@/graph/model/ids";
import { isTypingTarget } from "@/lib/shortcuts";
import {
  VISUAL_MODES,
  selectHasBlockingOverlay,
  useExplorerStore,
  type PanelId,
} from "@/state/explorer-store";

/**
 * Global discrete keyboard shortcuts for the explorer (see src/lib/shortcuts.ts).
 * Continuous movement keys (WASD/QE) belong to the camera rig.
 *
 * Rules:
 * - Ignored while typing in a field or when Ctrl/Meta/Alt is held.
 * - Inside composite widgets (trees, listboxes, sliders, ...) only Escape is
 *   handled, so type-ahead and arrow-key navigation keep working.
 * - Ignored entirely while a blocking overlay (search, share, shortcuts, code
 *   viewer) is open: those handle their own keys, including Escape.
 * - Enter is only taken over when focus is on the page body or the 3D canvas,
 *   so buttons and links keep their native keyboard behaviour.
 * - Tab is never taken over: it always moves focus, so everything after the
 *   canvas (selection details, panels, timeline, minimap) stays reachable.
 */

/** Attribute marking the element that wraps the 3D canvas. */
export const CANVAS_ATTRIBUTE = "data-explorer-canvas";

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "target"
  | "defaultPrevented"
  | "preventDefault"
>;

export interface ShortcutContext {
  /** Whether the 3D world is shown; camera, mode and navigation keys need it. */
  worldEnabled: boolean;
  onTogglePerf?: () => void;
}

/** Non-blocking overlays closed by Escape, top-most first. */
const ESCAPABLE_PANELS: readonly PanelId[] = ["summary", "contributors", "analytics"];

function isElement(target: EventTarget | null): target is Element {
  return typeof Element !== "undefined" && target instanceof Element;
}

export function isInsideCanvas(target: EventTarget | null): boolean {
  return isElement(target) && target.closest(`[${CANVAS_ATTRIBUTE}]`) !== null;
}

/** Composite widgets that own printable/navigation keys (type-ahead trees, listboxes, sliders, ...). */
const COMPOSITE_WIDGETS = [
  "tree",
  "treegrid",
  "grid",
  "listbox",
  "menu",
  "menubar",
  "radiogroup",
  "slider",
  "spinbutton",
  "tablist",
]
  .map((role) => `[role="${role}"]`)
  .join(",");

/** True when focus is inside a widget that handles its own keys; only Escape is handled globally then. */
export function isInsideCompositeWidget(target: EventTarget | null): boolean {
  return isElement(target) && target.closest(COMPOSITE_WIDGETS) !== null;
}

function isPageBody(target: EventTarget | null): boolean {
  if (!target) return true;
  if (typeof document === "undefined") return false;
  return target === document.body || target === document.documentElement || target === document;
}

/** Handles one keydown; returns true when the event was consumed. */
export function handleExplorerShortcut(event: ShortcutKeyEvent, context: ShortcutContext): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;

  const store = useExplorerStore.getState();
  if (selectHasBlockingOverlay(store)) return false;

  const neutralTarget = isPageBody(event.target) || isInsideCanvas(event.target);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  const consume = (action: () => void): boolean => {
    event.preventDefault();
    action();
    return true;
  };

  // Keys that repeat meaningfully are none of ours; ignore auto-repeat to avoid toggle flicker.
  if (event.repeat) return false;
  if (key !== "Escape" && isInsideCompositeWidget(event.target)) return false;

  switch (key) {
    case "/":
      return consume(() => store.setPanel("search", true));
    case "?":
      return consume(() => store.togglePanel("shortcuts"));
    case "Escape": {
      const openPanel = ESCAPABLE_PANELS.find((panel) => store.panels[panel]);
      if (openPanel) return consume(() => store.setPanel(openPanel, false));
      if (store.selection) return consume(() => store.select(null));
      if (store.focusedDirectoryId) return consume(() => store.focusDirectory(null));
      return false;
    }
    case "Backspace": {
      const focused = store.focusedDirectoryId;
      if (!focused) return false;
      const parentId = store.index?.directoriesById.get(focused)?.parentId ?? null;
      return consume(() =>
        store.focusDirectory(parentId && parentId !== ROOT_DIRECTORY_ID ? parentId : null),
      );
    }
    case "Enter": {
      if (!neutralTarget || store.selection?.kind !== "directory") return false;
      const directoryId = store.selection.id;
      return consume(() => store.focusDirectory(directoryId));
    }
    case "v": {
      const selection = store.selection;
      if (selection?.kind === "file") {
        const file = store.index?.filesById.get(selection.id);
        if (!file || file.status === "binary") return false;
        return consume(() => store.openCodeViewer({ fileId: selection.id }));
      }
      if (selection?.kind === "symbol") {
        const symbol = store.index?.symbolsById.get(selection.id);
        if (!symbol) return false;
        return consume(() =>
          store.openCodeViewer({
            fileId: symbol.fileId,
            line: symbol.startLine,
            endLine: symbol.endLine,
          }),
        );
      }
      return false;
    }
    case "i":
      return consume(() => store.togglePanel("analytics"));
    case "t":
      return consume(() => store.setTimeline({ active: !store.timeline.active }));
  }

  if (!context.worldEnabled) return false;

  switch (key) {
    case "r":
      return consume(() => store.issueCameraCommand({ type: "reset" }));
    case "h":
      return consume(() => store.issueCameraCommand({ type: "focus-repository" }));
    case "f": {
      if (!store.selection) return false;
      return consume(() => store.issueCameraCommand({ type: "focus-selected" }));
    }
    case "l":
      return consume(() => store.toggleDependencies());
    case "`": {
      if (!context.onTogglePerf) return false;
      return consume(context.onTogglePerf);
    }
    case "g":
      return consume(() =>
        store.setNavigationMode(store.navigationMode === "orbit" ? "explore" : "orbit"),
      );
  }

  const modeIndex = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
  const mode = VISUAL_MODES[modeIndex];
  if (mode) return consume(() => store.setVisualMode(mode.id));
  return false;
}

export interface ExplorerShortcutOptions {
  /** Listen only while the explorer UI is shown. */
  enabled: boolean;
  worldEnabled: boolean;
  /** Toggles the performance overlay (backquote). Keep the reference stable. */
  onTogglePerf?: () => void;
}

/** Binds the explorer's global keyboard shortcuts to `window`. */
export function useExplorerShortcuts({
  enabled,
  worldEnabled,
  onTogglePerf,
}: ExplorerShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      handleExplorerShortcut(event, { worldEnabled, onTogglePerf });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, worldEnabled, onTogglePerf]);
}
