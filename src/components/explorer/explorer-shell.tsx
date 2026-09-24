"use client";

import { useCallback, useState, type ReactNode } from "react";
import { CodeViewer } from "@/components/code-viewer/code-viewer";
import { Minimap } from "@/components/minimap/minimap";
import { RepositorySummary } from "@/components/overlays/repository-summary";
import { ShortcutsOverlay } from "@/components/overlays/shortcuts-overlay";
import { AnalyticsPanel } from "@/components/panels/analytics-panel";
import { ContributorsPanel } from "@/components/panels/contributors-panel";
import { SearchPalette } from "@/components/search/search-palette";
import { Timeline } from "@/components/timeline/timeline";
import { HudStack, WorldHud, WorldUnavailable } from "./explorer-hud";
import { SelectionAnnouncer } from "./selection-announcer";
import { SelectionPanel } from "./selection-panel";
import { ShareDialog } from "./share-dialog";
import { TopBar } from "./top-bar";
import type { ExplorerPhase } from "./use-explorer-phase";
import { useExplorerShortcuts } from "./use-explorer-shortcuts";

export interface ExplorerShellProps {
  phase: ExplorerPhase;
  fullName: string;
  /** False when the 3D world cannot be shown (the text summary replaces it). */
  worldEnabled: boolean;
  /** Extra explanation shown above the text summary when the world is unavailable. */
  worldUnavailableNotice: string | null;
  /** Ref from the URL (?ref=), preserved in share links. */
  requestedRef?: string;
  /** The persistent 3D viewport (rendered behind everything). */
  world: ReactNode;
  /** Loading or error screen shown above the world. */
  overlay: ReactNode;
}

/**
 * Full-viewport explorer layout: the canvas fills the screen and every piece
 * of UI floats above it in glass panels. Chrome (top bar, panels, overlays)
 * appears once the explorer opens; before that only the world preview and the
 * loading/error overlay are shown.
 */
export function ExplorerShell({
  phase,
  fullName,
  worldEnabled,
  worldUnavailableNotice,
  requestedRef,
  world,
  overlay,
}: ExplorerShellProps) {
  const chrome = phase === "entering" || phase === "explorer";
  const [perfOpen, setPerfOpen] = useState(false);
  const togglePerf = useCallback(() => setPerfOpen((value) => !value), []);
  useExplorerShortcuts({ enabled: chrome, worldEnabled, onTogglePerf: togglePerf });

  return (
    <div className="bg-void text-ink relative h-dvh w-full overflow-hidden">
      {chrome ? <TopBar worldEnabled={worldEnabled} /> : null}

      <main aria-label={`${fullName} explorer`} className="absolute inset-0">
        {world}
        {chrome ? (
          <>
            {worldEnabled ? (
              <>
                {/* The standalone summary brings its own heading when the world is unavailable. */}
                <h1 className="sr-only">{`${fullName} in 3D`}</h1>
                <WorldHud />
              </>
            ) : (
              <WorldUnavailable notice={worldUnavailableNotice} />
            )}
            <HudStack perfOpen={perfOpen && worldEnabled} />
          </>
        ) : null}
        {overlay}
      </main>

      {chrome ? (
        <>
          <SelectionPanel />
          <AnalyticsPanel />
          <ContributorsPanel />
          <Timeline />
          {worldEnabled ? (
            <div className="max-md:hidden">
              <Minimap />
            </div>
          ) : null}
          {worldEnabled ? <RepositorySummary /> : null}
          <CodeViewer />
          <SearchPalette />
          <ShortcutsOverlay />
          <ShareDialog requestedRef={requestedRef} />
          <SelectionAnnouncer />
        </>
      ) : null}
    </div>
  );
}
