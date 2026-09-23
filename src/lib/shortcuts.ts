/**
 * Keyboard shortcuts. Single source of truth for the shortcuts overlay (`?`)
 * and the handlers:
 * - Continuous movement keys (WASD/QE/Shift) are handled by the camera rig.
 * - Discrete command keys are handled by the explorer shell.
 * Handlers must ignore events while typing in inputs or when a modal is open.
 */

export type ShortcutGroup = "Navigation" | "Selection" | "View" | "Panels";

export interface KeyboardShortcut {
  /** Display keys, e.g. ["W", "A", "S", "D"]. */
  keys: string[];
  action: string;
  group: ShortcutGroup;
}

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { keys: ["W", "A", "S", "D"], action: "Move (Explore mode)", group: "Navigation" },
  { keys: ["Q", "E"], action: "Move down / up (Explore mode)", group: "Navigation" },
  { keys: ["Shift"], action: "Move faster", group: "Navigation" },
  { keys: ["Drag"], action: "Look around / orbit", group: "Navigation" },
  { keys: ["Scroll"], action: "Zoom", group: "Navigation" },
  { keys: ["Tab"], action: "Switch Orbit / Explore mode", group: "Navigation" },
  { keys: ["R"], action: "Reset camera", group: "Navigation" },
  { keys: ["H"], action: "Focus whole repository", group: "Navigation" },
  { keys: ["Click"], action: "Select", group: "Selection" },
  { keys: ["Double-click"], action: "Focus object", group: "Selection" },
  { keys: ["F"], action: "Focus selected", group: "Selection" },
  { keys: ["Enter"], action: "Enter selected directory", group: "Selection" },
  { keys: ["Backspace"], action: "Go up one directory", group: "Selection" },
  { keys: ["Esc"], action: "Deselect / close", group: "Selection" },
  { keys: ["V"], action: "View source of selected file", group: "Selection" },
  { keys: ["1"], action: "Architecture mode", group: "View" },
  { keys: ["2"], action: "Dependencies mode", group: "View" },
  { keys: ["3"], action: "Activity mode", group: "View" },
  { keys: ["4"], action: "Contributors mode", group: "View" },
  { keys: ["5"], action: "Complexity mode", group: "View" },
  { keys: ["L"], action: "Toggle dependency lines", group: "View" },
  { keys: ["/"], action: "Search", group: "Panels" },
  { keys: ["I"], action: "Repository statistics", group: "Panels" },
  { keys: ["T"], action: "History timeline", group: "Panels" },
  { keys: ["?"], action: "Keyboard shortcuts", group: "Panels" },
];

/** True when the event target is a text field where shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}
