"use client";

import { useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { LayoutLookup } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { getLayoutLookup } from "./layout-lookup-cache";
import { HoverChannel, ThrottledValue, suspendHoverWhileDragging } from "./pointer";

/**
 * Data shared by every layer of a rendered world: the layout, the graph index,
 * O(1) layout lookups and the (throttled) hover channel. Provided inside the
 * R3F canvas, so layers never prop-drill and never recompute lookups.
 */
export interface WorldContextValue {
  layout: WorldLayout;
  index: GraphIndex;
  lookup: LayoutLookup;
  /** Hover updates from pickable layers; throttled into `store.hover`, silent while dragging. */
  hover: HoverChannel<NodeRef>;
  interactive: boolean;
}

const WorldContext = createContext<WorldContextValue | null>(null);

/** Hover store writes are limited to ~20 Hz; the last value always lands. */
const HOVER_INTERVAL_MS = 50;

const sameRef = (a: NodeRef | null, b: NodeRef | null) => a?.id === b?.id && a?.kind === b?.kind;

/** Pointer cursor over pickable objects (imperative DOM write, kept outside React). */
function setCursor(element: HTMLElement, cursor: string): void {
  element.style.cursor = cursor;
}

export function WorldProvider({
  layout,
  index,
  interactive,
  children,
}: {
  layout: WorldLayout;
  index: GraphIndex;
  interactive: boolean;
  children: ReactNode;
}) {
  const domElement = useThree((state) => state.gl.domElement);
  const eventSource = useThree((state) => state.events.connected as HTMLElement | null | undefined);
  const inputElement = eventSource ?? domElement;
  const lookup = useMemo(() => getLayoutLookup(layout), [layout]);
  const hover = useMemo(
    () =>
      new HoverChannel<NodeRef>(
        new ThrottledValue<NodeRef | null>(
          (ref) => {
            useExplorerStore.getState().hover(ref);
            setCursor(domElement, ref ? "pointer" : "");
          },
          HOVER_INTERVAL_MS,
          sameRef,
        ),
      ),
    [domElement],
  );

  useEffect(() => {
    if (!interactive) return;
    return suspendHoverWhileDragging(inputElement, hover);
  }, [interactive, inputElement, hover]);

  useEffect(
    () => () => {
      hover.dispose();
      setCursor(domElement, "");
      if (useExplorerStore.getState().hovered) useExplorerStore.getState().hover(null);
    },
    [hover, domElement],
  );

  const value = useMemo<WorldContextValue>(
    () => ({ layout, index, lookup, hover, interactive }),
    [layout, index, lookup, hover, interactive],
  );
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}

export function useWorld(): WorldContextValue {
  const value = useContext(WorldContext);
  if (!value) throw new Error("useWorld() must be used inside <WorldProvider>");
  return value;
}

export { refFileId } from "./encodings";
