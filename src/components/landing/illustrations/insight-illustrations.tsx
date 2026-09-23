import { Caption, IllustrationFrame, IsoScene, PALETTE, type SceneBox } from "./iso-scene";

/**
 * Feature illustrations about history, people, search and sharing.
 * Decorative; the card text carries the meaning.
 */

const BASE = 0.1;
const DIM = "#2a3850";

function row(specs: ReadonlyArray<readonly [number, string]>, spacing = 0.95): SceneBox[] {
  return specs.map(([height, color], index) => ({
    x: (index - (specs.length - 1) / 2) * spacing,
    z: 0,
    width: 0.6,
    depth: 0.6,
    height,
    baseY: BASE,
    color,
  }));
}

/** Commit counts per bucket for the timeline strip (illustrative shape only). */
const TIMELINE = [2, 3, 1, 4, 6, 3, 2, 5, 7, 4, 3, 6, 8, 5, 4, 7, 9, 6, 5, 8, 10, 7, 9, 6, 4, 8];

export function ActivityIllustration() {
  const { signal } = PALETTE;
  const windowStart = 17;
  const windowEnd = 22;
  return (
    <IllustrationFrame>
      <IsoScene
        originX={120}
        originY={52}
        scale={15}
        slabs={[{ x: 0, z: 0, width: 6.4, depth: 1.4, height: BASE }]}
        boxes={row([
          [1.2, DIM],
          [2.0, signal],
          [0.9, DIM],
          [1.6, DIM],
          [2.4, signal],
          [1.1, DIM],
          [1.4, signal],
        ])}
      />
      <g transform="translate(14 78)">
        {TIMELINE.map((count, index) => {
          const inWindow = index >= windowStart && index <= windowEnd;
          return (
            <rect
              key={index}
              x={index * 8}
              y={28 - count * 2.6}
              width={5}
              height={count * 2.6}
              rx={1}
              className={inWindow ? "fill-signal" : "fill-line-strong"}
            />
          );
        })}
        <rect
          x={windowStart * 8 - 2}
          y={-2}
          width={(windowEnd - windowStart + 1) * 8 + 1}
          height={32}
          rx={3}
          className="fill-signal/10 stroke-signal/60"
        />
        <line x1={0} x2={208} y1={31} y2={31} className="stroke-line" />
      </g>
      <Caption x={14} y={20}>
        last 30 days
      </Caption>
    </IllustrationFrame>
  );
}

function Avatar({ cx, cy, active }: { cx: number; cy: number; active: boolean }) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={11}
        className={active ? "fill-ion/20 stroke-ion" : "fill-panel-raised stroke-line-strong"}
        strokeWidth={1.25}
      />
      <circle cx={cx} cy={cy - 3} r={3.5} className={active ? "fill-ion" : "fill-ink-muted/60"} />
      <path
        d={`M${cx - 6} ${cy + 7} Q ${cx} ${cy - 1} ${cx + 6} ${cy + 7}`}
        className={active ? "fill-ion" : "fill-ink-muted/60"}
      />
    </g>
  );
}

export function ContributorsIllustration() {
  const { ion } = PALETTE;
  const scene: SceneBox[] = [
    { x: -1.2, z: -1.1, width: 0.6, depth: 0.6, height: 1.4, baseY: BASE, color: ion },
    { x: 0, z: -1.2, width: 0.6, depth: 0.6, height: 0.8, baseY: BASE, color: DIM },
    { x: 1.1, z: -1.0, width: 0.6, depth: 0.6, height: 1.9, baseY: BASE, color: DIM },
    { x: -1.1, z: 0.1, width: 0.6, depth: 0.6, height: 1.0, baseY: BASE, color: DIM },
    { x: 0.1, z: 0.0, width: 0.6, depth: 0.6, height: 2.3, baseY: BASE, color: ion },
    { x: 1.2, z: 0.2, width: 0.6, depth: 0.6, height: 1.2, baseY: BASE, color: DIM },
    { x: -1.0, z: 1.2, width: 0.6, depth: 0.6, height: 0.7, baseY: BASE, color: DIM },
    { x: 0.2, z: 1.2, width: 0.6, depth: 0.6, height: 1.5, baseY: BASE, color: ion },
    { x: 1.3, z: 1.3, width: 0.6, depth: 0.6, height: 0.9, baseY: BASE, color: DIM },
  ];
  return (
    <IllustrationFrame>
      <g className="stroke-ion/60" strokeWidth={1} strokeDasharray="2 2.5">
        <path d="M44 60 C 90 60, 110 30, 152 36" />
        <path d="M44 60 C 96 62, 118 58, 160 54" />
        <path d="M44 60 C 92 66, 118 88, 156 80" />
      </g>
      <Avatar cx={32} cy={26} active={false} />
      <Avatar cx={32} cy={60} active />
      <Avatar cx={32} cy={94} active={false} />
      <IsoScene
        originX={170}
        originY={60}
        scale={15}
        slabs={[{ x: 0.1, z: 0.1, width: 3.7, depth: 3.7, height: BASE }]}
        boxes={scene}
      />
    </IllustrationFrame>
  );
}

export function SearchIllustration() {
  const code: Array<[number, number]> = [
    [0, 44],
    [6, 58],
    [6, 34],
    [12, 50],
    [6, 26],
    [0, 12],
    [0, 40],
    [6, 52],
  ];
  const highlighted = 3;
  return (
    <IllustrationFrame>
      <rect
        x={8}
        y={12}
        width={104}
        height={96}
        rx={8}
        className="fill-panel-raised stroke-line-strong"
      />
      <rect x={16} y={20} width={88} height={18} rx={5} className="fill-void stroke-signal/60" />
      <rect x={22} y={25} width={9} height={9} rx={2} className="stroke-ink-muted" />
      <text x={26.5} y={32} textAnchor="middle" className="fill-ink-muted font-mono" fontSize="7">
        /
      </text>
      <rect x={36} y={28} width={34} height={3} rx={1.5} className="fill-ink" />
      {[0, 1, 2].map((index) => (
        <g key={index}>
          {index === 0 ? (
            <rect x={16} y={46} width={88} height={16} rx={4} className="fill-signal/10" />
          ) : null}
          <rect
            x={22}
            y={52 + index * 18}
            width={5}
            height={5}
            rx={1.5}
            className={index === 0 ? "fill-signal" : "fill-line-strong"}
          />
          <rect
            x={32}
            y={53 + index * 18}
            width={[46, 38, 52][index]}
            height={3}
            rx={1.5}
            className={index === 0 ? "fill-ink" : "fill-line-strong"}
          />
        </g>
      ))}
      <rect x={120} y={12} width={112} height={96} rx={8} className="fill-abyss stroke-line" />
      <rect x={120} y={22 + highlighted * 10} width={112} height={9} className="fill-signal/10" />
      <rect x={120} y={22 + highlighted * 10} width={2} height={9} className="fill-signal" />
      {code.map(([indent, width], index) => (
        <g key={index}>
          <rect
            x={128}
            y={25 + index * 10}
            width={6}
            height={3}
            rx={1}
            className="fill-line-strong"
          />
          <rect
            x={142 + indent}
            y={25 + index * 10}
            width={width}
            height={3}
            rx={1.5}
            className={
              index === highlighted
                ? "fill-signal"
                : index % 3 === 0
                  ? "fill-ion/70"
                  : "fill-line-strong"
            }
          />
        </g>
      ))}
    </IllustrationFrame>
  );
}

function MiniScene({ originX, originY }: { originX: number; originY: number }) {
  const { typescript, ion, signal } = PALETTE;
  return (
    <IsoScene
      originX={originX}
      originY={originY}
      scale={10}
      slabs={[{ x: 0, z: 0, width: 3.2, depth: 3.2, height: BASE }]}
      boxes={[
        { x: -0.8, z: -0.7, width: 0.6, depth: 0.6, height: 1.6, baseY: BASE, color: typescript },
        { x: 0.6, z: -0.6, width: 0.6, depth: 0.6, height: 1.0, baseY: BASE, color: ion },
        {
          x: -0.4,
          z: 0.7,
          width: 0.6,
          depth: 0.6,
          height: 2.2,
          baseY: BASE,
          color: signal,
          selected: true,
        },
        { x: 0.8, z: 0.7, width: 0.6, depth: 0.6, height: 0.8, baseY: BASE, color: typescript },
      ]}
    />
  );
}

export function ShareIllustration() {
  return (
    <IllustrationFrame>
      <rect
        x={20}
        y={10}
        width={200}
        height={20}
        rx={10}
        className="fill-panel-raised stroke-line-strong"
      />
      <g className="stroke-signal" strokeWidth={1.4} fill="none">
        <rect x={30} y={17} width={9} height={6} rx={3} />
        <rect x={35} y={17} width={9} height={6} rx={3} />
      </g>
      <text x={52} y={23} className="fill-ink-muted font-mono" fontSize="7.5">
        /explore/owner/repo?…
      </text>
      <rect x={14} y={40} width={92} height={70} rx={8} className="fill-abyss stroke-line" />
      <rect x={134} y={40} width={92} height={70} rx={8} className="fill-abyss stroke-line" />
      <MiniScene originX={60} originY={82} />
      <MiniScene originX={180} originY={82} />
      <g className="stroke-signal/70" strokeWidth={1.25}>
        <line x1={110} x2={128} y1={75} y2={75} strokeDasharray="3 2" />
        <path d="M124 71.5 L128.5 75 L124 78.5" strokeLinecap="round" />
      </g>
    </IllustrationFrame>
  );
}
