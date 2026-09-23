import type { RepositoryGraph } from "@/graph/model/types";
import { isoBounds, isoFaces, projectIso, shadeHex } from "../iso";
import { buildPosterScene } from "./poster-scene";

/** Width of the projected city in SVG user units (strokes and labels are sized for it). */
const TARGET_WIDTH = 960;
const PADDING = 36;

export interface DemoPosterProps {
  graph: RepositoryGraph;
  className?: string;
}

/**
 * Static isometric render of a repository's 3D world (server component). Shown
 * in place of the live world until it has started, and permanently when WebGL
 * is unavailable. Rendered at build time, so it costs no client JavaScript.
 */
export function DemoPoster({ graph, className }: DemoPosterProps) {
  const scene = buildPosterScene(graph);
  const everything = [...scene.districts, ...scene.buildings];
  const unit = isoBounds(everything, 1);
  const scale = TARGET_WIDTH / Math.max(1, unit.maxX - unit.minX);
  const bounds = isoBounds(everything, scale);
  const viewBox = [
    bounds.minX - PADDING,
    bounds.minY - PADDING,
    bounds.maxX - bounds.minX + PADDING * 2,
    bounds.maxY - bounds.minY + PADDING * 2,
  ]
    .map((value) => Math.round(value))
    .join(" ");
  const labelled = scene.districts.filter((district) => district.label);

  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={`Static preview of ${graph.repository.fullName}: ${graph.files.length} files drawn as buildings across ${labelled.length} top-level districts.`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <g>
        {scene.districts.map((district) => {
          const faces = isoFaces(district, scale);
          return (
            <g key={district.id}>
              <polygon points={faces.left} className="fill-abyss" />
              <polygon points={faces.right} className="fill-void" />
              <polygon
                points={faces.top}
                className={
                  district.level === 0 ? "fill-abyss stroke-line" : "fill-panel stroke-line-strong"
                }
                strokeWidth={1}
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </g>
      <g stroke="#04060b" strokeOpacity={0.5} strokeWidth={0.75} strokeLinejoin="round">
        {scene.buildings.map((building) => {
          const faces = isoFaces(building, scale);
          return (
            <g key={building.id}>
              <polygon points={faces.left} fill={shadeHex(building.color, 0.62)} />
              <polygon points={faces.right} fill={shadeHex(building.color, 0.42)} />
              <polygon points={faces.top} fill={building.color} />
            </g>
          );
        })}
      </g>
      <g
        className="fill-ink-muted stroke-void font-mono"
        fontSize={13}
        strokeWidth={4}
        paintOrder="stroke"
      >
        {labelled.map((district) => {
          // Anchor at the district's front-left edge, just outside the slab.
          const anchor = projectIso(
            district.x - district.width / 2,
            district.baseY ?? 0,
            district.z + district.depth / 2,
            scale,
          );
          return (
            <text key={district.id} x={anchor.x + 4} y={anchor.y + 16} letterSpacing={0.5}>
              {district.label}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
