import {
  LOGO_FACES,
  LOGO_ORBIT,
  LOGO_ORBIT_FRONT,
  LOGO_ORBIT_KNOCKOUT,
  LOGO_SATELLITE,
} from "@/components/brand/logo-geometry";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";

export type BrandSurface = "color" | "light";

interface MarkPalette {
  top: string;
  left: string;
  right: string;
  orbit: string;
  orbitBackOpacity: number;
  satellite: string;
}

/**
 * On the gradient the mark is monochrome white (brand colors would fight the
 * mesh); on white it keeps the brand faces with a navy orbit.
 */
const PALETTES: Record<BrandSurface, MarkPalette> = {
  color: {
    top: "#ffffff",
    left: "rgb(255 255 255 / 0.72)",
    right: "rgb(255 255 255 / 0.46)",
    orbit: "#ffffff",
    orbitBackOpacity: 0.5,
    satellite: "#ffffff",
  },
  light: {
    top: "#4de2ff",
    left: "#9b8cff",
    right: "#1b7f99",
    orbit: "#0f1c3f",
    orbitBackOpacity: 0.4,
    satellite: "#1b7f99",
  },
};

/**
 * The CodeVerse mark for light and colored surfaces. The orbit's gap in front
 * of the tower is cut with a mask, so it reads correctly over any background
 * (the shared LogoMark paints the gap in a solid "knockout" color instead).
 */
export function BrandMark({
  surface,
  maskId,
  className,
}: {
  surface: BrandSurface;
  /** Unique per page: the knockout mask is referenced by id. */
  maskId: string;
  className?: string;
}) {
  const palette = PALETTES[surface];
  return (
    <svg
      viewBox="0 0 32 32"
      width={28}
      height={28}
      aria-hidden="true"
      focusable="false"
      fill="none"
      className={cn("shrink-0", className)}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="#fff" />
          <path d={LOGO_ORBIT_KNOCKOUT} stroke="#000" strokeWidth={LOGO_ORBIT.strokeWidth * 2.2} />
        </mask>
      </defs>
      <ellipse
        cx={LOGO_ORBIT.cx}
        cy={LOGO_ORBIT.cy}
        rx={LOGO_ORBIT.rx}
        ry={LOGO_ORBIT.ry}
        stroke={palette.orbit}
        strokeOpacity={palette.orbitBackOpacity}
        strokeWidth={LOGO_ORBIT.strokeWidth}
      />
      <g mask={`url(#${maskId})`}>
        <path d={LOGO_FACES.top} fill={palette.top} />
        <path d={LOGO_FACES.left} fill={palette.left} />
        <path d={LOGO_FACES.right} fill={palette.right} />
      </g>
      <path
        d={LOGO_ORBIT_FRONT}
        stroke={palette.orbit}
        strokeWidth={LOGO_ORBIT.strokeWidth}
        strokeLinecap="round"
      />
      <circle
        cx={LOGO_SATELLITE.cx}
        cy={LOGO_SATELLITE.cy}
        r={LOGO_SATELLITE.r}
        fill={palette.satellite}
      />
    </svg>
  );
}

/** Mark + wordmark. The wordmark is real text, so the lockup's name is the product name. */
export function BrandLockup({
  surface,
  maskId,
  className,
}: {
  surface: BrandSurface;
  maskId: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark surface={surface} maskId={maskId} className="size-7" />
      <span
        className={cn(
          "text-[17px] font-semibold tracking-[-0.02em]",
          surface === "color" ? "text-white" : "text-(--lc-ink)",
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
