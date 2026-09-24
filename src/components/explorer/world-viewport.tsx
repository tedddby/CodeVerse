"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import type { ExplorerPhase } from "./use-explorer-phase";
import { CANVAS_ATTRIBUTE } from "./use-explorer-shortcuts";

/** WebGL renderer, client-only (three.js cannot render on the server). */
const UniverseCanvas = dynamic(() => import("@/engine/rendering/universe-canvas"), { ssr: false });

export interface WorldViewportProps {
  phase: ExplorerPhase;
  fullName: string;
}

export const CANVAS_DESCRIPTION_ID = "explorer-canvas-description";

/**
 * The 3D world. Mounted once for the whole visit so the same scene is shown
 * dimmed and auto-rotating behind the loading screen (preview graph), then
 * "zooms in" and becomes interactive when the explorer opens.
 */
export const WorldViewport = memo(function WorldViewport({ phase, fullName }: WorldViewportProps) {
  const webglAvailable = useExplorerStore((state) => state.webglAvailable);
  const hasGraph = useExplorerStore((state) => state.graph !== null);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  if (webglAvailable !== true || !hasGraph) return null;

  const interactive = phase === "entering" || phase === "explorer";
  const canvasAttributes = { [CANVAS_ATTRIBUTE]: "" };

  return (
    <div
      {...canvasAttributes}
      role={interactive ? "application" : undefined}
      aria-roledescription={interactive ? "3D map" : undefined}
      aria-label={interactive ? `Interactive 3D map of ${fullName}` : undefined}
      aria-describedby={interactive ? CANVAS_DESCRIPTION_ID : undefined}
      aria-hidden={interactive ? undefined : true}
      inert={!interactive}
      tabIndex={interactive ? 0 : -1}
      className={cn(
        "absolute inset-0 z-0 transition-[opacity,transform,filter] duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        // The canvas's positioned wrappers paint over an outline, so the keyboard
        // focus ring is drawn by an overlay above them instead.
        "focus-visible:after:ring-signal after:pointer-events-none after:absolute after:inset-0 after:z-10 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset",
        interactive ? "scale-100 opacity-100" : "scale-[0.94] opacity-45 saturate-[0.6]",
        phase === "error" && "opacity-20 blur-[2px]",
      )}
    >
      {interactive ? (
        <p id={CANVAS_DESCRIPTION_ID} className="sr-only">
          Drag to orbit, scroll to zoom and click a building to select a file. Press G to fly with
          W, A, S, D or the arrow keys, and question mark for keyboard shortcuts. The Text summary
          button in the toolbar opens a screen-reader friendly overview of the repository.
        </p>
      ) : null}
      <UniverseCanvas
        className="size-full"
        interactive={interactive}
        autoRotate={!interactive && !reducedMotion}
      />
    </div>
  );
});
