import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { cn } from "@/lib/utils/cn";
import { cityGeometry } from "./city-geometry";
import styles from "./landing.module.css";

const GEOMETRY_ID = "lc-city-geometry";

export interface HeroCityProps {
  /** "color": white line art for the gradient; "page": ink line art on paper. */
  surface: "color" | "page";
  /**
   * Emit the shared geometry. Exactly one instance per page does this (the
   * hero's); every other instance references it with <use>.
   */
  withGeometry?: boolean;
  /** Unique id for the luminance mask of a "color" instance. */
  maskId?: string;
  className?: string;
}

/**
 * The demo repository's real layout (the engine's deterministic layout,
 * projected isometrically) as line art. The geometry is written once; each
 * instance restyles it through custom properties that inherit into the
 * <use> shadow tree. On color, a luminance mask gives hidden-line removal
 * that works over a moving background: nearer faces are opaque in the mask
 * and hide the edges behind them.
 */
export function HeroCity({ surface, withGeometry = false, maskId, className }: HeroCityProps) {
  const geometry = cityGeometry(mockRepositoryGraph);
  const [x, y, width, height] = geometry.viewBox.split(" ");

  return (
    <svg
      viewBox={geometry.viewBox}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      className={cn("block h-auto", className)}
      style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
    >
      {withGeometry ? (
        <defs>
          {/* Painter's order: every face paints over the ones behind it. */}
          <g id={GEOMETRY_ID} strokeWidth={1} strokeLinejoin="round">
            {geometry.faces.map((face) => (
              <g key={face.id} className={styles.cityFaces}>
                <polygon points={face.left} className={styles.cityLeft} />
                <polygon points={face.right} className={styles.cityRight} />
                <polygon
                  points={face.top}
                  className={face.kind === "district" ? styles.cityGround : styles.cityTop}
                />
              </g>
            ))}
          </g>
        </defs>
      ) : null}
      {surface === "color" && maskId ? (
        <>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height}>
              <use href={`#${GEOMETRY_ID}`} className={styles.cityMaskInk} />
            </mask>
          </defs>
          <rect x={x} y={y} width={width} height={height} fill="#ffffff" mask={`url(#${maskId})`} />
        </>
      ) : (
        <use href={`#${GEOMETRY_ID}`} className={styles.cityPageInk} />
      )}
    </svg>
  );
}
