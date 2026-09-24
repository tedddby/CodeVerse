"use client";

import { Crosshair, Gamepad2, RotateCcw, Scan } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";

/** Floating camera controls (bottom-right): reset, focus selection, frame repository, navigation mode. */
export function CameraControlsBar({ className }: { className?: string }) {
  const hasSelection = useExplorerStore((state) => state.selection !== null);
  const navigationMode = useExplorerStore((state) => state.navigationMode);
  const issueCameraCommand = useExplorerStore((state) => state.issueCameraCommand);
  const setNavigationMode = useExplorerStore((state) => state.setNavigationMode);

  return (
    <div
      role="group"
      aria-label="Camera controls"
      className={cn(
        "glass pointer-events-auto fixed bottom-2 right-2 z-20 flex items-center gap-0.5 rounded-xl p-0.5 animate-fade-in md:bottom-4 md:right-4",
        // On narrow screens the selection panel is a bottom sheet occupying this corner.
        hasSelection && "max-md:hidden",
        className,
      )}
    >
      {/* The bar sits at the right screen edge: tooltips align to their button's right edge. */}
      <IconButton
        label="Reset camera"
        shortcut="R"
        tooltipSide="top"
        tooltipAlign="end"
        icon={<RotateCcw />}
        onClick={() => issueCameraCommand({ type: "reset" })}
      />
      <IconButton
        label="Focus selected"
        shortcut="F"
        tooltipSide="top"
        tooltipAlign="end"
        icon={<Crosshair />}
        disabled={!hasSelection}
        onClick={() => issueCameraCommand({ type: "focus-selected" })}
      />
      <IconButton
        label="Frame whole repository"
        shortcut="H"
        tooltipSide="top"
        tooltipAlign="end"
        icon={<Scan />}
        onClick={() => issueCameraCommand({ type: "focus-repository" })}
      />
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line-strong" />
      <IconButton
        label="Explore mode"
        shortcut="G"
        tooltipSide="top"
        tooltipAlign="end"
        pressed={navigationMode === "explore"}
        icon={<Gamepad2 />}
        onClick={() => setNavigationMode(navigationMode === "orbit" ? "explore" : "orbit")}
      />
    </div>
  );
}
