"use client";

import { Map as MapIcon, Minimize2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { IconButton } from "@/components/ui/icon-button";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { drawDynamicLayer, drawStaticLayer, type MinimapCanvasContext } from "./minimap-draw";
import {
  boundsCenter,
  createMinimapTransform,
  minimapToWorld,
  panPoint,
  type MinimapTransform,
  type PanDirection,
} from "./minimap-geometry";

/** Map side in CSS pixels. */
export const MINIMAP_SIZE = 200;
/** Minimum interval between camera-layer redraws (≤ 10 Hz). */
const DYNAMIC_REDRAW_MS = 100;
/** Minimum interval between camera commands while dragging. */
const DRAG_COMMAND_MS = 80;

/** Offscreen static layer per visible canvas (the cached bitmap the dynamic layer composites). */
const staticLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function sizeCanvas(canvas: HTMLCanvasElement, pixels: number): void {
  if (canvas.width !== pixels) canvas.width = pixels;
  if (canvas.height !== pixels) canvas.height = pixels;
}

function staticLayerFor(canvas: HTMLCanvasElement): HTMLCanvasElement {
  let layer = staticLayers.get(canvas);
  if (!layer) {
    layer = document.createElement("canvas");
    staticLayers.set(canvas, layer);
  }
  sizeCanvas(layer, canvas.width);
  return layer;
}

const PAN_KEYS: Record<string, PanDirection> = {
  ArrowUp: "north",
  ArrowDown: "south",
  ArrowLeft: "west",
  ArrowRight: "east",
};

/**
 * Bottom-left 2D overview ("REPOSITORY MAP"): districts, buildings in language
 * colors, the selection in flare amber, the focused directory and the camera
 * footprint. Click or drag to fly there; arrow keys pan, Enter recentres.
 */
export function Minimap() {
  const layout = useExplorerStore((state) => state.layout);
  const index = useExplorerStore((state) => state.index);
  const timelineActive = useExplorerStore((state) => state.timeline.active);
  const [collapsed, setCollapsed] = useState(false);
  if (!layout || !index) return null;

  const placement = cn(
    "fixed left-3 z-20 hidden sm:block",
    // The timeline spans the full width below lg; sit above it then.
    timelineActive ? "bottom-[16.5rem] lg:bottom-3" : "bottom-3",
  );

  if (collapsed) {
    return (
      <div className={placement}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Show repository map"
          className="glass text-ink-muted hover:text-ink flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-[10.5px] tracking-[0.18em] uppercase transition-colors"
        >
          <MapIcon aria-hidden="true" className="size-3.5" />
          Map
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label="Repository map"
      className={cn(placement, "glass overflow-hidden rounded-xl shadow-2xl")}
    >
      <div className="border-line/70 flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
        <h2 className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
          Repository map
        </h2>
        <IconButton
          size="sm"
          tooltipSide="top"
          label="Collapse map"
          aria-expanded
          icon={<Minimize2 />}
          onClick={() => setCollapsed(true)}
          className="[&_svg]:size-3.5!"
        />
      </div>
      <MinimapCanvas layout={layout} index={index} />
    </section>
  );
}

function MinimapCanvas({ layout, index }: { layout: WorldLayout; index: GraphIndex }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; lastCommand: number } | null>(null);
  const selection = useExplorerStore((state) => state.selection);
  const focusedDirectoryId = useExplorerStore((state) => state.focusedDirectoryId);
  const visualMode = useExplorerStore((state) => state.visualMode);
  const activeContributorId = useExplorerStore((state) => state.activeContributorId);
  const issueCameraCommand = useExplorerStore((state) => state.issueCameraCommand);
  const transform = useMemo(
    () => createMinimapTransform(layout.bounds, MINIMAP_SIZE, 8),
    [layout.bounds],
  );

  const drawDynamic = useCallback((currentTransform: MinimapTransform) => {
    const canvas = canvasRef.current;
    const ctx: MinimapCanvasContext | null = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const ratio = canvas.width / MINIMAP_SIZE;
    drawDynamicLayer(
      ctx,
      staticLayers.get(canvas) ?? null,
      currentTransform,
      useExplorerStore.getState().cameraPose,
      ratio,
    );
  }, []);

  // Static layer: redrawn only when the layout, selection, focus or mode changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    sizeCanvas(canvas, Math.round(MINIMAP_SIZE * ratio));
    const ctx: MinimapCanvasContext | null = staticLayerFor(canvas).getContext("2d");
    if (!ctx) return;
    drawStaticLayer(
      ctx,
      { layout, transform, index, selection, focusedDirectoryId, visualMode, activeContributorId },
      ratio,
    );
    drawDynamic(transform);
  }, [
    layout,
    transform,
    index,
    selection,
    focusedDirectoryId,
    visualMode,
    activeContributorId,
    drawDynamic,
  ]);

  // Dynamic layer: camera pose changes arrive via a store subscription (no React re-render), throttled to ≤ 10 Hz.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const redraw = () => {
      timer = null;
      last = performance.now();
      drawDynamic(transform);
    };
    const unsubscribe = useExplorerStore.subscribe((state, previous) => {
      if (state.cameraPose === previous.cameraPose || timer) return;
      timer = setTimeout(redraw, Math.max(0, DYNAMIC_REDRAW_MS - (performance.now() - last)));
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [drawDynamic, transform]);

  const flyTo = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? MINIMAP_SIZE / rect.width : 1;
    const point = minimapToWorld(
      transform,
      (event.clientX - rect.left) * scale,
      (event.clientY - rect.top) * scale,
    );
    issueCameraCommand({ type: "focus-point", x: point.x, z: point.z });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastCommand: performance.now() };
    flyTo(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    if (now - drag.lastCommand < DRAG_COMMAND_MS) return;
    drag.lastCommand = now;
    flyTo(event);
  };

  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      issueCameraCommand({ type: "focus-repository" });
      return;
    }
    const direction = PAN_KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    const pose = useExplorerStore.getState().cameraPose;
    const from = pose ? { x: pose.target[0], z: pose.target[2] } : boundsCenter(layout.bounds);
    const next = panPoint(layout.bounds, from, direction, event.shiftKey ? 0.2 : 0.08);
    issueCameraCommand({ type: "focus-point", x: next.x, z: next.z });
  };

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
      tabIndex={0}
      role="application"
      aria-roledescription="minimap"
      aria-label="Repository map. Click or drag to fly the camera; arrow keys pan (Shift for larger steps), Enter recentres on the whole repository."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="block cursor-crosshair touch-none focus-visible:outline-offset-[-2px]"
      style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
    />
  );
}
