import type { ReactElement } from "react";
import { BRAND_COLORS } from "@/components/brand/logo-geometry";
import { SOCIAL_CARD_FONT_FAMILY, SocialMark } from "@/components/brand/social-card";
import { formatCompact, formatInteger } from "@/lib/utils/format";
import { normalizeInlineText, stripEmoji, truncateText } from "./metadata";
import type { OgThumbnail } from "./og-thumbnail";
import { svgDataUri, thumbnailToSvg } from "./og-thumbnail-svg";

/**
 * Per-repository social preview card rendered by `next/og` (Satori).
 *
 * Satori supports a subset of CSS: flexbox and absolute positioning only, and
 * every element with more than one child must be `display: flex`. All
 * repository-provided text is sanitized and rendered as plain text.
 */

export const OG_THUMBNAIL_SIZE = { width: 560, height: 460 } as const;

const LINE = "#1a2434";
const LINE_STRONG = "#2a3850";
const ABYSS = "#070b13";
const INK_SUBTLE = "#627089";

export interface RepositoryCardData {
  owner: string;
  repo: string;
  description?: string;
  stars?: number;
  forks?: number;
  language?: { name: string; color: string };
  thumbnail: OgThumbnail;
  /** Host shown in the footer, e.g. "codeverse.dev". */
  host: string;
  siteName: string;
}

/** Sanitizes untrusted text for the card: single line, no emoji, bounded length. */
export function cardText(value: string, maxLength: number): string {
  return truncateText(stripEmoji(normalizeInlineText(value)), maxLength);
}

/** Keeps typical names on one line within the ~496px text column. */
function repoNameFontSize(name: string): number {
  if (name.length <= 10) return 72;
  if (name.length <= 15) return 58;
  if (name.length <= 22) return 44;
  return 36;
}

function StarIcon({ color }: { color: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round">
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

function ForkIcon({ color }: { color: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

function Thumbnail({ thumbnail }: { thumbnail: OgThumbnail }) {
  const caption =
    thumbnail.kind === "city"
      ? `CITY MAP · ${formatInteger(thumbnail.totalBuildings)} ${thumbnail.totalBuildings === 1 ? "FILE" : "FILES"}`
      : "ABSTRACT PREVIEW · EXPLORE TO MAP THE CODE";
  return (
    <div
      style={{
        position: "absolute",
        right: 56,
        top: 62,
        width: OG_THUMBNAIL_SIZE.width,
        height: OG_THUMBNAIL_SIZE.height + 44,
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${LINE_STRONG}`,
        borderRadius: 22,
        backgroundColor: ABYSS,
        overflow: "hidden",
      }}
    >
      {/* One embedded SVG instead of thousands of positioned boxes: Satori lays out a single element. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
      <img
        src={svgDataUri(thumbnailToSvg(thumbnail))}
        width={OG_THUMBNAIL_SIZE.width}
        height={OG_THUMBNAIL_SIZE.height}
        alt=""
        style={{ width: OG_THUMBNAIL_SIZE.width, height: OG_THUMBNAIL_SIZE.height }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          paddingLeft: 20,
          borderTop: `1px solid ${LINE}`,
          fontFamily: SOCIAL_CARD_FONT_FAMILY.mono,
          fontSize: 15,
          letterSpacing: 2,
          color: thumbnail.kind === "city" ? BRAND_COLORS.signal : INK_SUBTLE,
        }}
      >
        {caption}
      </div>
    </div>
  );
}

/** Card for a specific repository with its generated visualization thumbnail. */
export function RepositoryOgCard(data: RepositoryCardData): ReactElement {
  const owner = cardText(data.owner, 40);
  const repo = cardText(data.repo, 60);
  const description = data.description ? cardText(data.description, 150) : "";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: BRAND_COLORS.void,
        backgroundImage:
          "radial-gradient(circle at 80% 30%, rgba(77, 226, 255, 0.14), transparent 52%), radial-gradient(circle at 6% 108%, rgba(155, 140, 255, 0.14), transparent 46%)",
        color: BRAND_COLORS.ink,
        fontFamily: SOCIAL_CARD_FONT_FAMILY.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 560,
          height: "100%",
          padding: "56px 0 54px 64px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <SocialMark size={44} />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 600, letterSpacing: -0.6 }}>{data.siteName}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: SOCIAL_CARD_FONT_FAMILY.mono, fontSize: 26, color: BRAND_COLORS.inkMuted }}>
            {`${owner} /`}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 6,
              fontSize: repoNameFontSize(repo),
              fontWeight: 600,
              letterSpacing: -1.5,
              lineHeight: 1.05,
            }}
          >
            {repo}
          </div>
          {description ? (
            <div style={{ display: "flex", marginTop: 20, fontSize: 25, lineHeight: 1.4, color: BRAND_COLORS.inkMuted }}>
              {description}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 28, fontSize: 24 }}>
            {data.stars !== undefined ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StarIcon color={BRAND_COLORS.inkMuted} />
                <span>{formatCompact(data.stars)}</span>
              </div>
            ) : null}
            {data.forks !== undefined ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ForkIcon color={BRAND_COLORS.inkMuted} />
                <span>{formatCompact(data.forks)}</span>
              </div>
            ) : null}
            {data.language ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: `1px solid ${LINE_STRONG}`,
                  fontSize: 21,
                }}
              >
                <div style={{ width: 12, height: 12, borderRadius: 12, backgroundColor: data.language.color }} />
                <span>{cardText(data.language.name, 24)}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 }}>
          <span style={{ color: BRAND_COLORS.signal, fontWeight: 600 }}>Explore it in 3D →</span>
          <span style={{ color: INK_SUBTLE, fontFamily: SOCIAL_CARD_FONT_FAMILY.mono, fontSize: 19 }}>{data.host}</span>
        </div>
      </div>
      <Thumbnail thumbnail={data.thumbnail} />
    </div>
  );
}
