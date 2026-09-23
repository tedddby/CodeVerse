"use client";

import { Fragment, useId } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Kbd, SectionLabel } from "@/components/ui/primitives";
import { KEYBOARD_SHORTCUTS, type KeyboardShortcut, type ShortcutGroup } from "@/lib/shortcuts";
import { useExplorerStore } from "@/state/explorer-store";

const GROUP_ORDER: readonly ShortcutGroup[] = ["Navigation", "Selection", "View", "Panels"];

/** Mouse gestures listed alongside keys; shown as plain labels rather than key caps. */
const POINTER_GESTURES: ReadonlySet<string> = new Set(["Drag", "Scroll", "Click", "Double-click"]);

/** Groups shortcuts in display order; groups without entries are dropped. */
export function groupShortcuts(
  shortcuts: readonly KeyboardShortcut[],
): Array<{ group: ShortcutGroup; items: KeyboardShortcut[] }> {
  return GROUP_ORDER.map((group) => ({
    group,
    items: shortcuts.filter((shortcut) => shortcut.group === group),
  })).filter((entry) => entry.items.length > 0);
}

function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && keys.length === 2 ? (
            <span aria-hidden="true" className="text-ink-subtle text-[10px]">
              /
            </span>
          ) : null}
          {POINTER_GESTURES.has(key) ? (
            <span className="border-line-strong text-ink-muted rounded-md border border-dashed px-1.5 font-mono text-[11px] leading-[1.35rem]">
              {key}
            </span>
          ) : (
            <Kbd>{key}</Kbd>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** Keyboard shortcut reference (`panels.shortcuts`, opened with "?"). */
export function ShortcutsOverlay() {
  const open = useExplorerStore((state) => state.panels.shortcuts);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const idPrefix = useId();
  if (!open) return null;

  return (
    <Dialog
      open
      onClose={() => setPanel("shortcuts", false)}
      title="Keyboard shortcuts"
      description="Shortcuts are paused while you type in a text field or a dialog is open."
      className="max-w-3xl!"
    >
      <div className="grid max-h-[70vh] gap-x-10 gap-y-6 overflow-y-auto px-5 pt-4 pb-5 sm:grid-cols-2">
        {groupShortcuts(KEYBOARD_SHORTCUTS).map(({ group, items }) => (
          <section key={group} aria-labelledby={`${idPrefix}-${group}`}>
            <SectionLabel className="mb-2">
              <span id={`${idPrefix}-${group}`}>{group}</span>
            </SectionLabel>
            <dl className="space-y-1.5">
              {items.map((shortcut) => (
                <div
                  key={`${shortcut.action}-${shortcut.keys.join("+")}`}
                  className="flex items-center justify-between gap-4"
                >
                  <dt className="text-ink-muted text-sm">{shortcut.action}</dt>
                  <dd>
                    <ShortcutKeys keys={shortcut.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="border-line/60 text-ink-subtle border-t px-5 py-3 text-xs">
        Press <Kbd>?</Kbd> anytime to show this list.
      </p>
    </Dialog>
  );
}
