import type { OgThumbnail } from "./og-thumbnail";

/**
 * SVG serialization of social-card thumbnails (see og-thumbnail.ts).
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FALLBACK_COLOR = "#4de2ff";

function svgNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "0";
}

function svgOpacity(value: number): string {
  return Number.isFinite(value) ? String(Math.min(1, Math.max(0, Math.round(value * 1000) / 1000))) : "1";
}

/**
 * Serializes a thumbnail as a standalone SVG document. The social card embeds
 * it as a single image: Satori lays out one element instead of thousands of
 * positioned boxes (which takes tens of seconds), and resvg draws the
 * rectangles natively. Colors are whitelisted to hex literals, so nothing but
 * numbers and hex colors ever reaches the markup.
 */
export function thumbnailToSvg(thumbnail: OgThumbnail): string {
  const { width, height } = thumbnail;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(width)}" height="${svgNumber(height)}" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}">`,
    `<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1a2434" stroke-opacity="0.55" stroke-width="1"/></pattern></defs>`,
    `<rect width="${svgNumber(width)}" height="${svgNumber(height)}" fill="url(#grid)"/>`,
  ];
  for (const district of thumbnail.districts) {
    const level = Math.min(Math.max(district.level, 0), 6);
    parts.push(
      `<rect x="${svgNumber(district.x)}" y="${svgNumber(district.y)}" width="${svgNumber(district.width)}" height="${svgNumber(district.height)}" rx="3" fill="${FALLBACK_COLOR}" fill-opacity="${svgOpacity(0.03 + level * 0.018)}" stroke="${FALLBACK_COLOR}" stroke-opacity="${svgOpacity(0.12 + level * 0.03)}" stroke-width="1"/>`,
    );
  }
  for (const building of thumbnail.buildings) {
    const color = HEX_COLOR.test(building.color) ? building.color : FALLBACK_COLOR;
    const radius = building.width > 6 ? 1.5 : 0;
    parts.push(
      `<rect x="${svgNumber(building.x)}" y="${svgNumber(building.y)}" width="${svgNumber(building.width)}" height="${svgNumber(building.height)}" rx="${radius}" fill="${color}" fill-opacity="${svgOpacity(building.opacity)}"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Base64 data URI for an SVG document (the serializer only emits ASCII). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
