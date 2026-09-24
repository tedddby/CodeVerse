import { shadeHex } from "@/components/landing/iso";
import { cn } from "@/lib/utils/cn";
import type { CityGeometry } from "./city-geometry";

export interface IsoArtProps {
  geometry: CityGeometry;
  /** Accessible description; omit for decorative art. */
  label?: string;
  className?: string;
  /** Slab colors for districts (light surfaces by default). */
  ground?: { top: string; left: string; right: string; edge: string };
}

const LIGHT_GROUND = { top: "#f7f8fc", left: "#e4e8f1", right: "#d7ddea", edge: "#c9d0df" };

/**
 * Colored isometric city for light surfaces: pale terraces, buildings in their
 * language colors with shaded sides and a hairline edge so pale colors still
 * separate from the paper.
 */
export function IsoArt({ geometry, label, className, ground = LIGHT_GROUND }: IsoArtProps) {
  const accessibility = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      focusable="false"
      className={cn("block", className)}
      {...accessibility}
    >
      <g strokeWidth={1} strokeLinejoin="round">
        {geometry.faces.map((face) => {
          if (face.kind === "district") {
            return (
              <g key={face.id} stroke={ground.edge}>
                <polygon points={face.left} fill={ground.left} vectorEffect="non-scaling-stroke" />
                <polygon points={face.right} fill={ground.right} vectorEffect="non-scaling-stroke" />
                <polygon points={face.top} fill={ground.top} vectorEffect="non-scaling-stroke" />
              </g>
            );
          }
          const color = face.color ?? "#8a94ad";
          return (
            <g key={face.id} stroke={shadeHex(color, 0.55)} strokeOpacity={0.55}>
              <polygon points={face.left} fill={shadeHex(color, 0.82)} vectorEffect="non-scaling-stroke" />
              <polygon points={face.right} fill={shadeHex(color, 0.66)} vectorEffect="non-scaling-stroke" />
              <polygon points={face.top} fill={color} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
