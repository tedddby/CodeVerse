import type { ReactNode } from "react";
import { isoFaces, shadeHex, type IsoBox } from "./iso";

/**
 * Small line-art diagrams for the four pipeline stages. Decorative (the step
 * text carries the meaning), drawn on a 240 x 120 canvas with design tokens.
 */

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 120" aria-hidden="true" className="h-auto w-full" fill="none">
      {children}
    </svg>
  );
}

function Arrow({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <g className="stroke-signal/70" strokeWidth={1.25}>
      <line x1={x1} x2={x2 - 4} y1={y} y2={y} strokeDasharray="3 3" />
      <path d={`M${x2 - 5} ${y - 3.5} L${x2} ${y} L${x2 - 5} ${y + 3.5}`} strokeLinecap="round" />
    </g>
  );
}

/** Fetch: the GitHub API streams the tree; nothing is cloned or run. */
export function FetchDiagram() {
  const rows: Array<[number, number, "dir" | "file"]> = [
    [0, 44, "dir"],
    [1, 36, "dir"],
    [2, 40, "file"],
    [2, 52, "file"],
    [1, 30, "file"],
    [0, 38, "dir"],
    [1, 46, "file"],
  ];
  return (
    <Frame>
      <rect
        x="6"
        y="36"
        width="80"
        height="48"
        rx="8"
        className="fill-panel-raised stroke-line-strong"
      />
      <text x="46" y="57" textAnchor="middle" className="fill-ink font-mono" fontSize="11">
        GitHub
      </text>
      <text x="46" y="72" textAnchor="middle" className="fill-ink-muted font-mono" fontSize="7.5">
        REST · GraphQL
      </text>
      <Arrow x1={90} x2={120} y={60} />
      <rect x="124" y="8" width="108" height="104" rx="8" className="fill-abyss stroke-line" />
      {rows.map(([depth, width, kind], index) => {
        const x = 136 + depth * 12;
        const y = 20 + index * 13;
        return (
          <g key={index}>
            {kind === "dir" ? (
              <rect x={x} y={y - 3} width="7" height="6" rx="1" className="fill-signal/80" />
            ) : (
              <rect
                x={x + 1}
                y={y - 3.5}
                width="5"
                height="7"
                rx="1"
                className="stroke-ink-muted"
              />
            )}
            <rect
              x={x + 11}
              y={y - 1.5}
              width={width}
              height="3"
              rx="1.5"
              className="fill-line-strong"
            />
          </g>
        );
      })}
    </Frame>
  );
}

/** Parse: tree-sitter turns source into an AST; symbols and imports are extracted. */
export function ParseDiagram() {
  const code: Array<[number, number, string]> = [
    [0, 30, "fill-ion/80"],
    [0, 46, "fill-line-strong"],
    [0, 24, "fill-signal/80"],
    [8, 40, "fill-line-strong"],
    [8, 30, "fill-line-strong"],
    [0, 8, "fill-line-strong"],
    [0, 36, "fill-signal/80"],
  ];
  const nodes = {
    root: [182, 18],
    importNode: [148, 56],
    classNode: [182, 56],
    functionNode: [216, 56],
    method: [168, 94],
    field: [196, 94],
  } as const;
  const edges: Array<[keyof typeof nodes, keyof typeof nodes]> = [
    ["root", "importNode"],
    ["root", "classNode"],
    ["root", "functionNode"],
    ["classNode", "method"],
    ["classNode", "field"],
  ];
  return (
    <Frame>
      <rect x="8" y="8" width="92" height="104" rx="8" className="fill-abyss stroke-line" />
      {code.map(([indent, width, className], index) => (
        <rect
          key={index}
          x={18 + indent}
          y={21 + index * 12}
          width={width}
          height="3.5"
          rx="1.75"
          className={className}
        />
      ))}
      <Arrow x1={104} x2={132} y={60} />
      <g className="stroke-line-strong" strokeWidth={1}>
        {edges.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={nodes[from][0]}
            y1={nodes[from][1]}
            x2={nodes[to][0]}
            y2={nodes[to][1]}
          />
        ))}
      </g>
      <circle
        cx={nodes.root[0]}
        cy={nodes.root[1]}
        r="6"
        className="fill-panel-raised stroke-ink-muted"
      />
      <circle
        cx={nodes.importNode[0]}
        cy={nodes.importNode[1]}
        r="5.5"
        className="fill-ion/25 stroke-ion"
      />
      <circle
        cx={nodes.classNode[0]}
        cy={nodes.classNode[1]}
        r="5.5"
        className="fill-signal/25 stroke-signal"
      />
      <circle
        cx={nodes.functionNode[0]}
        cy={nodes.functionNode[1]}
        r="5.5"
        className="fill-signal/25 stroke-signal"
      />
      <circle
        cx={nodes.method[0]}
        cy={nodes.method[1]}
        r="4.5"
        className="fill-signal/15 stroke-signal/70"
      />
      <circle
        cx={nodes.field[0]}
        cy={nodes.field[1]}
        r="4.5"
        className="fill-signal/15 stroke-signal/70"
      />
    </Frame>
  );
}

/** Graph: a normalized model of directories, files, symbols, imports and history. */
export function GraphDiagram() {
  return (
    <Frame>
      <g className="stroke-line-strong" strokeWidth={1}>
        <line x1="36" y1="34" x2="92" y2="26" />
        <line x1="36" y1="34" x2="92" y2="62" />
        <line x1="36" y1="86" x2="92" y2="98" />
        <line x1="120" y1="26" x2="170" y2="18" />
        <line x1="120" y1="26" x2="170" y2="40" />
        <line x1="190" y1="80" x2="120" y2="62" strokeDasharray="2 3" />
        <line x1="190" y1="80" x2="120" y2="98" strokeDasharray="2 3" />
        <line x1="222" y1="100" x2="190" y2="80" />
      </g>
      <g className="stroke-ion" strokeWidth={1.25}>
        <path d="M106 36 C 100 46, 100 50, 106 56" />
        <path d="M104 72 C 96 82, 96 86, 104 92" />
      </g>
      <rect x="24" y="22" width="24" height="24" rx="4" className="fill-signal/15 stroke-signal" />
      <rect x="24" y="74" width="24" height="24" rx="4" className="fill-signal/15 stroke-signal" />
      {[
        [92, 18],
        [92, 54],
        [92, 90],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="28"
          height="16"
          rx="3"
          className="fill-panel-raised stroke-ink-muted"
        />
      ))}
      <circle cx="176" cy="18" r="4" className="fill-ion/30 stroke-ion" />
      <circle cx="176" cy="40" r="4" className="fill-ion/30 stroke-ion" />
      <path d="M190 72 L198 80 L190 88 L182 80 Z" className="fill-panel-raised stroke-ok" />
      <circle cx="222" cy="100" r="7" className="fill-panel-raised stroke-ink-muted" />
      <circle cx="222" cy="98" r="2.5" className="fill-ink-muted" />
    </Frame>
  );
}

const FAR_BOXES: IsoBox[] = [
  { x: -3.1, z: -2.2, width: 0.7, depth: 0.7, height: 1.3, baseY: 0.12 },
  { x: -2.1, z: -2.6, width: 0.7, depth: 0.7, height: 0.8, baseY: 0.12 },
  { x: -2.6, z: -1.3, width: 0.7, depth: 0.7, height: 1.0, baseY: 0.12 },
];

const NEAR_BOXES: Array<IsoBox & { color: string }> = [
  { x: 0.3, z: -0.3, width: 0.8, depth: 0.8, height: 2.6, baseY: 0.12, color: "#4de2ff" },
  { x: 1.4, z: -0.2, width: 0.8, depth: 0.8, height: 1.5, baseY: 0.12, color: "#3b8eea" },
  { x: 0.4, z: 0.9, width: 0.8, depth: 0.8, height: 1.1, baseY: 0.12, color: "#dea584" },
  { x: 1.5, z: 1.0, width: 0.8, depth: 0.8, height: 1.9, baseY: 0.12, color: "#9b8cff" },
];

const RENDER_SLABS: IsoBox[] = [
  { x: -2.6, z: -2.0, width: 2.3, depth: 2.3, height: 0.12 },
  { x: 0.9, z: 0.35, width: 2.7, depth: 2.7, height: 0.12 },
];

/** Render: deterministic layout, instanced buildings, detail only up close. */
export function RenderDiagram() {
  const scale = 17;
  return (
    <Frame>
      <g transform="translate(126 80)">
        {RENDER_SLABS.map((slab) => {
          const faces = isoFaces(slab, scale);
          return (
            <g key={slab.x}>
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
        {FAR_BOXES.map((box) => {
          const faces = isoFaces(box, scale);
          return (
            <g key={box.x} className="stroke-ink-muted/60" strokeWidth={0.75}>
              <polygon points={faces.left} className="fill-abyss" />
              <polygon points={faces.right} className="fill-abyss" />
              <polygon points={faces.top} className="fill-panel" />
            </g>
          );
        })}
        {NEAR_BOXES.map((box) => {
          const faces = isoFaces(box, scale);
          return (
            <g key={box.x + box.z} stroke="#04060b" strokeOpacity={0.5} strokeWidth={0.5}>
              <polygon points={faces.left} fill={shadeHex(box.color, 0.6)} />
              <polygon points={faces.right} fill={shadeHex(box.color, 0.4)} />
              <polygon points={faces.top} fill={box.color} />
            </g>
          );
        })}
      </g>
      <text x="10" y="18" className="fill-ink-muted font-mono" fontSize="7.5">
        far · outlines
      </text>
      <text x="230" y="112" textAnchor="end" className="fill-ink-muted font-mono" fontSize="7.5">
        near · full detail
      </text>
    </Frame>
  );
}
