"use client";

import { VISUAL_MODES, useExplorerStore } from "@/state/explorer-store";
import { describeSelection } from "./node-descriptions";

/**
 * Visually hidden live regions announcing selection, focused-directory and
 * visual-mode changes to screen-reader users (the canvas itself is opaque to
 * assistive technology).
 */
export function SelectionAnnouncer() {
  const selection = useExplorerStore((state) => state.selection);
  const index = useExplorerStore((state) => state.index);
  const focusedDirectoryId = useExplorerStore((state) => state.focusedDirectoryId);
  const visualMode = useExplorerStore((state) => state.visualMode);

  const selectionText = describeSelection(selection, index);
  const focusedPath = focusedDirectoryId
    ? index?.directoriesById.get(focusedDirectoryId)?.path
    : undefined;
  const focusText = focusedPath ? `Inside directory ${focusedPath}` : "";
  const modeLabel = VISUAL_MODES.find((mode) => mode.id === visualMode)?.label ?? visualMode;

  return (
    <div className="sr-only">
      <p aria-live="polite" aria-atomic="true">
        {selectionText}
      </p>
      <p aria-live="polite" aria-atomic="true">
        {focusText}
      </p>
      <p aria-live="polite" aria-atomic="true">{`${modeLabel} mode`}</p>
    </div>
  );
}
