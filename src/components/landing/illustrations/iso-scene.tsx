import type { ReactNode } from "react";
import { byDepth, isoFaces, shadeHex, type IsoBox } from "../iso";

/** Shared building blocks for the feature micro-illustrations (240 x 120 canvas). */

export function IllustrationFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 120" aria-hidden="true" className="h-auto w-full" fill="none">
      {children}
    </svg>
  );
}

export interface SceneBox extends IsoBox {
  /** Hex fill; omit for an outlined (not analyzed / far) building. */
  color?: string;
  /** Draws the building with the selection color outline. */
  selected?: boolean;
}

/** Draws district slabs and buildings in painter's order at the given origin/scale. */
export function IsoScene({
  originX,
  originY,
  scale,
  slabs = [],
  boxes,
}: {
  originX: number;
  originY: number;
  scale: number;
  slabs?: IsoBox[];
  boxes: SceneBox[];
}) {
  return (
    <g transform={`translate(${originX} ${originY})`}>
      {[...slabs].sort(byDepth).map((slab) => {
        const faces = isoFaces(slab, scale);
        return (
          <g key={`slab-${slab.x}-${slab.z}`}>
            <polygon points={faces.left} className="fill-abyss" />
            <polygon points={faces.right} className="fill-void" />
            <polygon
              points={faces.top}
              className="fill-panel stroke-line-strong"
              strokeWidth={0.75}
            />
          </g>
        );
      })}
      {[...boxes].sort(byDepth).map((box) => {
        const faces = isoFaces(box, scale);
        const key = `box-${box.x}-${box.z}`;
        if (!box.color) {
          return (
            <g key={key} className="stroke-ink-muted/50" strokeWidth={0.75} strokeDasharray="2 1.5">
              <polygon points={faces.left} className="fill-abyss" />
              <polygon points={faces.right} className="fill-abyss" />
              <polygon points={faces.top} className="fill-panel" />
            </g>
          );
        }
        return (
          <g
            key={key}
            stroke={box.selected ? "#ffb454" : "#04060b"}
            strokeOpacity={box.selected ? 1 : 0.5}
            strokeWidth={box.selected ? 1.25 : 0.5}
            strokeLinejoin="round"
          >
            <polygon points={faces.left} fill={shadeHex(box.color, 0.6)} />
            <polygon points={faces.right} fill={shadeHex(box.color, 0.4)} />
            <polygon points={faces.top} fill={box.color} />
          </g>
        );
      })}
    </g>
  );
}

/** Small monospace caption inside an illustration. */
export function Caption({
  x,
  y,
  children,
  anchor = "start",
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className="fill-ink-muted font-mono"
      fontSize="7.5"
      letterSpacing="0.4"
    >
      {children}
    </text>
  );
}

export const PALETTE = {
  typescript: "#3b8eea",
  python: "#4b8bbe",
  go: "#00add8",
  rust: "#dea584",
  java: "#e76f00",
  signal: "#4de2ff",
  ion: "#9b8cff",
  warn: "#ffcc66",
} as const;
