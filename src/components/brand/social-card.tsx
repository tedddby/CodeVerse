import type { CSSProperties } from "react";
import { siteConfig } from "@/config/site";
import {
  BRAND_COLORS,
  LOGO_FACES,
  LOGO_ORBIT,
  LOGO_ORBIT_FRONT,
  LOGO_ORBIT_KNOCKOUT,
  LOGO_SATELLITE,
  LOGO_VIEWBOX,
} from "./logo-geometry";

/**
 * 1200 x 630 social card rendered by `next/og` (Satori). Satori supports a
 * subset of CSS: flexbox and absolute positioning only, inline styles, and every
 * element with several children must be `display: flex`. Keep it that way.
 */

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

/** Font family names used in inline styles; loaded by `loadSocialCardFonts()`. */
export const SOCIAL_CARD_FONT_FAMILY = { sans: "Geist", mono: "Geist Mono" } as const;

const INK_SUBTLE = "#627089";
const LINE = "#1a2434";

/** Right-hand skyline: [width, height, color] per building, left to right. */
const SKYLINE: ReadonlyArray<readonly [number, number, string]> = [
  [30, 112, "#3b8eea"],
  [42, 206, BRAND_COLORS.signal],
  [28, 148, BRAND_COLORS.ion],
  [50, 318, BRAND_COLORS.signal],
  [34, 176, "#dea584"],
  [40, 246, BRAND_COLORS.ion],
  [28, 104, "#00add8"],
  [46, 284, "#3b8eea"],
  [32, 164, "#4b8bbe"],
  [40, 226, BRAND_COLORS.signal],
  [28, 126, BRAND_COLORS.ion],
];

/** Dependency arcs between buildings: [from index, to index, rise in px, color]. */
const ARCS: ReadonlyArray<readonly [number, number, number, string]> = [
  [1, 3, 64, BRAND_COLORS.signal],
  [3, 7, 88, BRAND_COLORS.ion],
  [5, 9, 54, BRAND_COLORS.signal],
];

const SKYLINE_GAP = 12;
const SKYLINE_RIGHT = 72;
const HORIZON_Y = 512;

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

interface PlacedBuilding {
  left: number;
  width: number;
  height: number;
  color: string;
}

function placeSkyline(): PlacedBuilding[] {
  const totalWidth =
    SKYLINE.reduce((sum, [width]) => sum + width, 0) + SKYLINE_GAP * (SKYLINE.length - 1);
  let left = SOCIAL_CARD_SIZE.width - SKYLINE_RIGHT - totalWidth;
  return SKYLINE.map(([width, height, color]) => {
    const placed = { left, width, height, color };
    left += width + SKYLINE_GAP;
    return placed;
  });
}

function Building({ building }: { building: PlacedBuilding }) {
  const { left, width, height, color } = building;
  const bands = Math.max(1, Math.floor(height / 58));
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: HORIZON_Y - height,
        width,
        height,
        display: "flex",
        flexDirection: "column",
        borderTop: `3px solid ${color}`,
        borderLeft: `1px solid ${withAlpha(color, 0.35)}`,
        borderRight: `1px solid ${withAlpha(color, 0.18)}`,
        backgroundImage: `linear-gradient(180deg, ${withAlpha(color, 0.3)} 0%, ${withAlpha(color, 0.08)} 55%, ${withAlpha(BRAND_COLORS.void, 0)} 100%)`,
      }}
    >
      {Array.from({ length: bands }, (_, band) => (
        <div
          key={band}
          style={{
            marginTop: band === 0 ? 18 : 30,
            marginLeft: 6,
            marginRight: 6,
            height: 2,
            backgroundColor: withAlpha(color, 0.35),
          }}
        />
      ))}
    </div>
  );
}

function Arc({
  from,
  to,
  rise,
  color,
}: {
  from: PlacedBuilding;
  to: PlacedBuilding;
  rise: number;
  color: string;
}) {
  const startX = from.left + from.width / 2;
  const endX = to.left + to.width / 2;
  // Anchor on the lower roof; the taller building (drawn later) hides the other end.
  const baseY = HORIZON_Y - Math.min(from.height, to.height);
  return (
    <div
      style={{
        position: "absolute",
        left: startX,
        top: baseY - rise,
        width: endX - startX,
        height: rise,
        display: "flex",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: endX - startX,
          height: rise * 2,
          border: `2px solid ${withAlpha(color, 0.75)}`,
          borderRadius: "50%",
        }}
      />
    </div>
  );
}

function Floor() {
  const offsets = [8, 20, 38, 62, 94];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: HORIZON_Y,
        width: SOCIAL_CARD_SIZE.width,
        height: SOCIAL_CARD_SIZE.height - HORIZON_Y,
        display: "flex",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 480,
          right: 0,
          top: 0,
          height: 1,
          backgroundImage: `linear-gradient(90deg, ${withAlpha(BRAND_COLORS.signal, 0)} 0%, ${withAlpha(BRAND_COLORS.signal, 0.85)} 45%, ${withAlpha(BRAND_COLORS.signal, 0.2)} 100%)`,
        }}
      />
      {offsets.map((offset, index) => (
        <div
          key={offset}
          style={{
            position: "absolute",
            left: 480 - index * 60,
            right: 0,
            top: offset,
            height: 1,
            backgroundImage: `linear-gradient(90deg, ${withAlpha(BRAND_COLORS.signal, 0)} 0%, ${withAlpha(BRAND_COLORS.signal, 0.22 - index * 0.035)} 60%, ${withAlpha(BRAND_COLORS.signal, 0.05)} 100%)`,
          }}
        />
      ))}
    </div>
  );
}

/** The CodeVerse mark for Satori (no React-specific or ARIA attributes needed). */
export function SocialMark({
  size,
  knockout = BRAND_COLORS.void,
}: {
  size: number;
  knockout?: string;
}) {
  const stroke = size >= 64 ? LOGO_ORBIT.strokeWidth : LOGO_ORBIT.smallStrokeWidth;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx={LOGO_ORBIT.cx}
        cy={LOGO_ORBIT.cy}
        rx={LOGO_ORBIT.rx}
        ry={LOGO_ORBIT.ry}
        stroke={BRAND_COLORS.ink}
        strokeOpacity={0.45}
        strokeWidth={stroke}
      />
      <path d={LOGO_FACES.top} fill={BRAND_COLORS.signal} />
      <path d={LOGO_FACES.left} fill={BRAND_COLORS.ion} />
      <path d={LOGO_FACES.right} fill={BRAND_COLORS.signalDim} />
      <path d={LOGO_ORBIT_KNOCKOUT} stroke={knockout} strokeWidth={stroke * 2.2} />
      <path
        d={LOGO_ORBIT_FRONT}
        stroke={BRAND_COLORS.ink}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <circle
        cx={LOGO_SATELLITE.cx}
        cy={LOGO_SATELLITE.cy}
        r={LOGO_SATELLITE.r}
        fill={BRAND_COLORS.signal}
        stroke={knockout}
        strokeWidth={1}
      />
    </svg>
  );
}

export interface SocialCardProps {
  /** Small monospace line above the title. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Monospace footer line (bottom left). */
  footer?: string;
}

const textBlock: CSSProperties = { display: "flex", flexDirection: "column", maxWidth: 560 };

export function SocialCard({ eyebrow, title, subtitle, footer }: SocialCardProps) {
  const buildings = placeSkyline();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: "56px 64px",
        backgroundColor: BRAND_COLORS.void,
        backgroundImage: `linear-gradient(90deg, ${withAlpha(LINE, 0.55)} 1px, transparent 1px), linear-gradient(0deg, ${withAlpha(LINE, 0.55)} 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
        color: BRAND_COLORS.ink,
        fontFamily: SOCIAL_CARD_FONT_FAMILY.sans,
      }}
    >
      <Floor />
      {ARCS.map(([fromIndex, toIndex, rise, color]) => {
        const from = buildings[fromIndex];
        const to = buildings[toIndex];
        return from && to ? (
          <Arc key={`${fromIndex}-${toIndex}`} from={from} to={to} rise={rise} color={color} />
        ) : null;
      })}
      {buildings.map((building) => (
        <Building key={building.left} building={building} />
      ))}

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <SocialMark size={52} />
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.6 }}>{siteConfig.name}</div>
      </div>

      <div style={{ ...textBlock, marginTop: "auto" }}>
        {eyebrow ? (
          <div
            style={{
              fontFamily: SOCIAL_CARD_FONT_FAMILY.mono,
              fontSize: 20,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: BRAND_COLORS.signal,
              marginBottom: 20,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div style={{ fontSize: 62, fontWeight: 600, lineHeight: 1.04, letterSpacing: -2 }}>
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 22,
              fontSize: 26,
              lineHeight: 1.35,
              color: BRAND_COLORS.inkMuted,
            }}
          >
            {subtitle}
          </div>
        ) : null}
        {footer ? (
          <div
            style={{
              marginTop: 30,
              fontFamily: SOCIAL_CARD_FONT_FAMILY.mono,
              fontSize: 18,
              color: INK_SUBTLE,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
