"use client";

import { Check, Hand, Rotate3d, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { useLayoutEngine } from "@/engine/layout/use-layout-engine";
import UniverseCanvas from "@/engine/rendering/universe-canvas";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { useExplorerStore } from "@/state/explorer-store";
import { prefersCoarsePointer, prefersReducedMotion } from "./browser-capabilities";
import { DemoReadout } from "./demo-readout";

/**
 * The live demo world: the real layout engine and WebGL renderer running on the
 * bundled demo repository. Loaded lazily (never on the server) by
 * `InteractiveDemo`, so three.js stays out of the landing page's initial bundle.
 */

export interface DemoWorldProps {
  /** Whether the demo is on (or near) screen; auto-rotation pauses otherwise. */
  visible: boolean;
  /** Called once the first frame of the world has been drawn. */
  onReady: () => void;
  /** Called when the world cannot be laid out; the poster stays visible. */
  onError: (message: string) => void;
}

const DEMO_REPOSITORY_ID = mockRepositoryGraph.repository.id;

export default function DemoWorld({ visible, onReady, onError }: DemoWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engagedRef = useRef(false);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [coarsePointer] = useState(prefersCoarsePointer);
  // No autoplaying motion for people who asked the OS for less of it.
  const [rotating, setRotating] = useState(() => !prefersReducedMotion());
  // Touch users must opt in, otherwise dragging over the scene would trap page scrolling.
  const [touchEngaged, setTouchEngaged] = useState(false);

  // Own the shared explorer store for the lifetime of the demo.
  useEffect(() => {
    const store = useExplorerStore.getState();
    store.setReducedMotion(reducedMotion);
    store.setWebglAvailable(true);
    store.loadGraph(mockRepositoryGraph);
    return () => {
      const state = useExplorerStore.getState();
      if (state.graph?.repository.id === DEMO_REPOSITORY_ID) state.reset();
    };
  }, [reducedMotion]);

  const { error: layoutError } = useLayoutEngine();
  // The canvas flags WebGL as unavailable when it cannot create a context.
  const webglFailed = useExplorerStore((state) => state.webglAvailable === false);

  useEffect(() => {
    if (layoutError) onError(layoutError);
    else if (webglFailed) onError("WebGL context could not be created");
  }, [layoutError, webglFailed, onError]);

  const ready = useExplorerStore(
    (state) => state.layout !== null && state.graph?.repository.id === DEMO_REPOSITORY_ID,
  );

  useEffect(() => {
    if (!ready) return;
    // Give the renderer a couple of frames to draw before the poster fades out.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onReady());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready, onReady]);

  // Cooperative scrolling for mouse users: the wheel zooms only after the user
  // has clicked into the scene, and scrolls the page again once they leave it.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || coarsePointer) return;
    const engage = () => {
      engagedRef.current = true;
    };
    const release = () => {
      engagedRef.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (!engagedRef.current) event.stopPropagation();
    };
    element.addEventListener("pointerdown", engage, { capture: true });
    element.addEventListener("pointerleave", release);
    element.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      element.removeEventListener("pointerdown", engage, { capture: true });
      element.removeEventListener("pointerleave", release);
      element.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [coarsePointer]);

  const resetView = () => {
    useExplorerStore.getState().select(null);
    useExplorerStore.getState().issueCameraCommand({ type: "reset" });
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      <div className="absolute inset-0">
        <UniverseCanvas
          interactive
          autoRotate={rotating && visible && !(coarsePointer && touchEngaged)}
        />
      </div>

      {coarsePointer && !touchEngaged ? (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-16">
          <button
            type="button"
            onClick={() => setTouchEngaged(true)}
            className="glass text-ink inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-lg"
          >
            <Hand aria-hidden="true" className="text-signal size-4" />
            Tap to interact
          </button>
        </div>
      ) : null}

      <div className="glass absolute top-3 right-3 z-20 flex items-center gap-1 rounded-xl p-1">
        {coarsePointer && touchEngaged ? (
          <IconButton
            label="Done interacting"
            icon={<Check />}
            size="sm"
            tooltipSide="left"
            onClick={() => setTouchEngaged(false)}
          />
        ) : null}
        <IconButton
          label="Auto-rotate"
          icon={<Rotate3d />}
          size="sm"
          pressed={rotating}
          tooltipSide="bottom"
          onClick={() => setRotating((value) => !value)}
        />
        <IconButton
          label="Reset view"
          icon={<RotateCcw />}
          size="sm"
          tooltipSide="left"
          onClick={resetView}
        />
      </div>

      <DemoReadout className="absolute right-3 bottom-3 left-3 z-20 sm:right-auto sm:max-w-[70%]" />
    </div>
  );
}
