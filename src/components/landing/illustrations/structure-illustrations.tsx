import { projectIso, type IsoBox } from "../iso";
import { Caption, IllustrationFrame, IsoScene, PALETTE, type SceneBox } from "./iso-scene";

/**
 * Feature illustrations about structure: districts, dependency arcs, complexity
 * and large-repository tiers. Decorative; the card text carries the meaning.
 */

const BASE = 0.1;

/** Buildings on a grid inside a district; `specs` are [height, color?] row by row. */
function grid(
  centerX: number,
  centerZ: number,
  columns: number,
  specs: ReadonlyArray<readonly [number, string?]>,
  cell = 0.74,
): SceneBox[] {
  const rows = Math.ceil(specs.length / columns);
  return specs.map(([height, color], index) => ({
    x: centerX + ((index % columns) - (columns - 1) / 2) * cell,
    z: centerZ + (Math.floor(index / columns) - (rows - 1) / 2) * cell,
    width: cell * 0.68,
    depth: cell * 0.68,
    height,
    baseY: BASE,
    color,
  }));
}

function slab(x: number, z: number, width: number, depth: number): IsoBox {
  return { x, z, width, depth, height: BASE };
}

const { typescript: ts, python: py, go, rust, java, warn } = PALETTE;
const DIM = "#2a3850";

export function ArchitectureIllustration() {
  return (
    <IllustrationFrame>
      <IsoScene
        originX={122}
        originY={66}
        scale={17}
        slabs={[slab(-1.5, -0.7, 2.5, 2.5), slab(1.5, -1.1, 2.4, 1.7), slab(0.1, 1.9, 2.5, 1.6)]}
        boxes={[
          ...grid(-1.5, -0.7, 3, [
            [1.6, ts],
            [0.9, ts],
            [2.3, ts],
            [0.7, ts],
            [1.3, ts],
            [1.9, ts],
            [0.6, ts],
            [1.1, ts],
            [0.8, ts],
          ]),
          ...grid(1.5, -1.1, 3, [
            [1.2, go],
            [2.0, go],
            [0.8, go],
            [0.6, rust],
            [1.5, rust],
            [1.0, rust],
          ]),
          ...grid(0.1, 1.9, 3, [
            [0.8, py],
            [0.5, py],
            [1.1, py],
            [0.6, java],
            [0.9, java],
            [0.4, java],
          ]),
        ]}
      />
      <Caption x={52} y={24}>
        src/
      </Caption>
      <Caption x={230} y={48} anchor="end">
        services/
      </Caption>
      <Caption x={16} y={102}>
        packages/
      </Caption>
    </IllustrationFrame>
  );
}

const DEPENDENCY_BOXES: SceneBox[] = [
  { x: 0, z: 0, width: 0.6, depth: 0.6, height: 2.2, baseY: BASE, color: ts, selected: true },
  { x: -2.2, z: -0.4, width: 0.6, depth: 0.6, height: 1.2, baseY: BASE, color: ts },
  { x: -0.6, z: -2.3, width: 0.6, depth: 0.6, height: 1.6, baseY: BASE, color: ts },
  { x: 2.2, z: 0.3, width: 0.6, depth: 0.6, height: 0.9, baseY: BASE, color: ts },
  { x: 0.5, z: 2.3, width: 0.6, depth: 0.6, height: 1.4, baseY: BASE, color: py },
];

function roof(box: SceneBox, originX: number, originY: number, scale: number) {
  const point = projectIso(box.x, (box.baseY ?? 0) + box.height, box.z, scale);
  return { x: originX + point.x, y: originY + point.y };
}

export function DependencyIllustration() {
  const [origin, scale] = [{ x: 120, y: 68 }, 16] as const;
  const roofs = DEPENDENCY_BOXES.map((box) => roof(box, origin.x, origin.y, scale));
  const [center, ...others] = roofs;
  if (!center) return null;
  return (
    <IllustrationFrame>
      <IsoScene
        originX={origin.x}
        originY={origin.y}
        scale={scale}
        slabs={[slab(0, 0, 5.4, 5.4)]}
        boxes={DEPENDENCY_BOXES}
      />
      {others.map((target, index) => {
        const outgoing = index % 2 === 0;
        const lift = 26 + index * 4;
        const midX = (center.x + target.x) / 2;
        const midY = Math.min(center.y, target.y) - lift;
        return (
          <path
            key={`${target.x}-${target.y}`}
            d={`M${center.x} ${center.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
            className={outgoing ? "stroke-signal" : "stroke-ion"}
            strokeWidth={1.3}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={center.x} cy={center.y} r={2.2} className="fill-flare" />
      <Caption x={12} y={112}>
        imports
      </Caption>
      <line x1={50} x2={62} y1={109.5} y2={109.5} className="stroke-signal" strokeWidth={1.5} />
      <Caption x={76} y={112}>
        imported by
      </Caption>
      <line x1={134} x2={146} y1={109.5} y2={109.5} className="stroke-ion" strokeWidth={1.5} />
    </IllustrationFrame>
  );
}

/** Horizontal bands on a building's two visible faces (symbols as floors). */
function Bands({
  box,
  originX,
  originY,
  scale,
  count,
  className,
}: {
  box: SceneBox;
  originX: number;
  originY: number;
  scale: number;
  count: number;
  className: string;
}) {
  const x0 = box.x - box.width / 2;
  const x1 = box.x + box.width / 2;
  const z0 = box.z - box.depth / 2;
  const z1 = box.z + box.depth / 2;
  const base = box.baseY ?? 0;
  const lines = Array.from(
    { length: count },
    (_, index) => base + ((index + 1) * box.height) / (count + 1),
  );
  const point = (x: number, y: number, z: number) => {
    const p = projectIso(x, y, z, scale);
    return `${originX + p.x},${originY + p.y}`;
  };
  return (
    <g className={className} strokeWidth={1}>
      {lines.map((y) => (
        <polyline key={y} points={`${point(x0, y, z1)} ${point(x1, y, z1)} ${point(x1, y, z0)}`} />
      ))}
    </g>
  );
}

const COMPLEXITY_BOXES: SceneBox[] = [
  { x: -1.6, z: -0.2, width: 0.8, depth: 0.8, height: 1.1, baseY: BASE, color: DIM },
  { x: 0, z: -1.3, width: 0.8, depth: 0.8, height: 1.5, baseY: BASE, color: DIM },
  { x: 0.4, z: 0.6, width: 1.0, depth: 1.0, height: 3.4, baseY: BASE, color: warn },
  { x: 1.9, z: -0.1, width: 0.8, depth: 0.8, height: 0.8, baseY: BASE, color: DIM },
  { x: -0.9, z: 1.6, width: 0.8, depth: 0.8, height: 1.8, baseY: BASE, color: "#8a6a2c" },
];

export function ComplexityIllustration() {
  const [originX, originY, scale] = [118, 80, 16] as const;
  const hot = COMPLEXITY_BOXES[2];
  const hotRoof = hot ? roof(hot, originX, originY, scale) : null;
  return (
    <IllustrationFrame>
      <IsoScene
        originX={originX}
        originY={originY}
        scale={scale}
        slabs={[slab(0.1, 0.2, 5, 4.4)]}
        boxes={COMPLEXITY_BOXES}
      />
      {hot ? (
        <Bands
          box={hot}
          originX={originX}
          originY={originY}
          scale={scale}
          count={7}
          className="stroke-void/70"
        />
      ) : null}
      {hotRoof ? (
        <g>
          <line
            x1={hotRoof.x + 5}
            y1={hotRoof.y - 3}
            x2={hotRoof.x + 32}
            y2={hotRoof.y - 14}
            className="stroke-warn/70"
          />
          <Caption x={hotRoof.x + 35} y={hotRoof.y - 12}>
            hotspot
          </Caption>
        </g>
      ) : null}
    </IllustrationFrame>
  );
}

function tierScene(kind: "full" | "progressive" | "directory-first"): SceneBox[] {
  const colors = [ts, go, py, ts, rust, ts, java, go, ts];
  const heights = [1.4, 0.8, 1.9, 0.6, 1.2, 2.2, 0.9, 1.5, 0.7];
  const specs = heights.map((height, index): readonly [number, string?] => {
    if (kind === "full") return [height, colors[index]];
    if (kind === "progressive") return index % 2 === 0 ? [height, colors[index]] : [height];
    return [0.25];
  });
  return grid(0, 0, 3, specs, 0.9);
}

export function LargeRepositoryIllustration() {
  const tiers = [
    { kind: "full", label: "FULL" },
    { kind: "progressive", label: "PROGRESSIVE" },
    { kind: "directory-first", label: "DIRECTORY-FIRST" },
  ] as const;
  return (
    <IllustrationFrame>
      {tiers.map(({ kind, label }, index) => {
        const left = 6 + index * 78;
        return (
          <g key={kind}>
            <rect
              x={left}
              y={8}
              width={72}
              height={104}
              rx={8}
              className="fill-void/60 stroke-line"
            />
            <IsoScene
              originX={left + 36}
              originY={58}
              scale={11}
              slabs={[slab(0, 0, 3.1, 3.1)]}
              boxes={tierScene(kind)}
            />
            <text
              x={left + 36}
              y={102}
              textAnchor="middle"
              className="fill-ink-muted font-mono"
              fontSize="6.5"
            >
              {label}
            </text>
          </g>
        );
      })}
    </IllustrationFrame>
  );
}
