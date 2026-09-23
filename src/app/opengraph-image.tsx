import { ImageResponse } from "next/og";
import { SOCIAL_CARD_SIZE, SocialCard } from "@/components/brand/social-card";
import { loadSocialCardFonts } from "@/components/brand/social-card-fonts";
import { siteConfig } from "@/config/site";

export const alt = `${siteConfig.name} — ${siteConfig.headline}`;
export const size = SOCIAL_CARD_SIZE;
export const contentType = "image/png";

/** Site-wide default social image (routes may override it with their own). */
export default async function OpenGraphImage() {
  const fonts = await loadSocialCardFonts();
  return new ImageResponse(
    <SocialCard
      eyebrow="Open source · MIT"
      title={siteConfig.headline}
      subtitle={siteConfig.tagline}
      footer="TypeScript · JavaScript · Python · Java · Go · Rust"
    />,
    { ...size, ...(fonts.length > 0 ? { fonts } : {}) },
  );
}
