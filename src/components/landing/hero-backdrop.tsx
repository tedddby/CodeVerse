/**
 * Hero backdrop: an engineering grid fading from the top, and a horizon with a
 * perspective floor and a faint skyline silhouette. Pure static SVG/CSS, no
 * images, filters or animation, so it never competes with the LCP text.
 */

const VIEW_WIDTH = 1600;
const VIEW_HEIGHT = 420;
const HORIZON = 230;
const VANISHING_X = VIEW_WIDTH / 2;

/** Deterministic pseudo-random sequence (Park–Miller) so every build draws the same skyline. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

interface Skyline {
  path: string;
  beacons: Array<{ x: number; y: number }>;
}

/** Skyline that stays low in the center (behind the copy) and rises towards the edges. */
function buildSkyline(): Skyline {
  const random = sequence(20_260_923);
  let x = 0;
  let path = `M0 ${HORIZON}`;
  const beacons: Skyline["beacons"] = [];
  while (x < VIEW_WIDTH) {
    const width = 14 + Math.round(random() * 38);
    const gap = random() < 0.35 ? 2 + Math.round(random() * 6) : 0;
    const distance = Math.abs(x + width / 2 - VANISHING_X) / VANISHING_X;
    const height = Math.round((10 + random() * 70) * (0.28 + 0.9 * distance ** 1.4));
    const top = HORIZON - height;
    path += ` V${top} H${x + width} V${HORIZON}`;
    if (height > 58 && random() < 0.45)
      beacons.push({ x: x + Math.round(width / 2) - 1, y: top - 5 });
    x += width;
    if (gap > 0) {
      path += ` H${x + gap}`;
      x += gap;
    }
  }
  return { path: `${path} Z`, beacons };
}

function floorLines(): { horizontals: number[]; radials: Array<[number, number]> } {
  const depth = VIEW_HEIGHT - HORIZON;
  const horizontals = Array.from({ length: 9 }, (_, index) => {
    const t = (index + 1) / 9;
    return Math.round(HORIZON + depth * t * t);
  });
  const radials: Array<[number, number]> = [];
  for (let lane = -16; lane <= 16; lane += 1) {
    radials.push([VANISHING_X + lane * 10, VANISHING_X + lane * 150]);
  }
  return { horizontals, radials };
}

const SKYLINE = buildSkyline();
const FLOOR = floorLines();

export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black_10%,transparent_75%)] opacity-40" />
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-x-0 bottom-0 h-[240px] w-full sm:h-[300px] lg:h-[340px]"
      >
        <defs>
          <linearGradient id="hero-horizon" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#4de2ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#4de2ff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#4de2ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hero-floor-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hero-edges" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.1" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.9" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="hero-floor-mask">
            <rect
              x="0"
              y={HORIZON}
              width={VIEW_WIDTH}
              height={VIEW_HEIGHT - HORIZON}
              fill="url(#hero-floor-fade)"
            />
          </mask>
          <mask id="hero-edges-mask">
            <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#hero-edges)" />
          </mask>
        </defs>

        <g mask="url(#hero-edges-mask)">
          <path d={SKYLINE.path} className="fill-panel stroke-line-strong" strokeWidth={1} />
          {SKYLINE.beacons.map((beacon) => (
            <rect
              key={`${beacon.x}-${beacon.y}`}
              x={beacon.x}
              y={beacon.y}
              width={2}
              height={2}
              className="fill-signal/60"
            />
          ))}
          <g mask="url(#hero-floor-mask)" className="stroke-line-strong" strokeWidth={1}>
            {FLOOR.horizontals.map((y) => (
              <line key={y} x1={0} x2={VIEW_WIDTH} y1={y} y2={y} />
            ))}
            {FLOOR.radials.map(([top, bottom]) => (
              <line key={top} x1={top} y1={HORIZON} x2={bottom} y2={VIEW_HEIGHT} />
            ))}
          </g>
          <rect
            x={0}
            y={HORIZON - 0.75}
            width={VIEW_WIDTH}
            height={1.5}
            fill="url(#hero-horizon)"
          />
        </g>
      </svg>
      <div className="to-void absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent" />
    </div>
  );
}
