"use client";

import { useEffect } from "react";
import { useExplorerStore } from "@/state/explorer-store";

/**
 * Placement shared by the left-docked panels (analytics, contributors): below
 * the explorer top bar (two rows below xl, one row from xl) and above the
 * minimap in the bottom-left corner (shown from md). On short screens the panel
 * keeps a usable minimum height and may overlap the minimap.
 */
export const LEFT_DOCK_CLASS = [
  "fixed left-3 top-[7.75rem] z-30 w-[min(22rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-8.5rem)]",
  "md:max-h-[max(18rem,calc(100dvh-7.75rem-16.5rem))]",
  "xl:top-[4.75rem] xl:max-h-[max(18rem,calc(100dvh-4.75rem-16.5rem))]",
].join(" ");

type LeftDockPanel = "analytics" | "contributors";

/**
 * Only one left-docked panel is visible at a time: when `panel` opens, the
 * other one closes ("last opened wins").
 */
export function useExclusiveLeftDock(panel: LeftDockPanel, open: boolean): void {
  const setPanel = useExplorerStore((state) => state.setPanel);
  useEffect(() => {
    if (!open) return;
    const { panels } = useExplorerStore.getState();
    // Another dock panel may already have closed this one in the same commit.
    if (!panels[panel]) return;
    const other: LeftDockPanel = panel === "analytics" ? "contributors" : "analytics";
    if (panels[other]) setPanel(other, false);
  }, [open, panel, setPanel]);
}
