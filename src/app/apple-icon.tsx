import { ImageResponse } from "next/og";
import { SocialMark } from "@/components/brand/social-card";
import { BRAND_COLORS } from "@/components/brand/logo-geometry";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon. iOS applies its own corner mask, so the tile is a full square. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BRAND_COLORS.void,
        backgroundImage: `linear-gradient(180deg, ${BRAND_COLORS.panel} 0%, ${BRAND_COLORS.void} 100%)`,
      }}
    >
      <SocialMark size={132} />
    </div>,
    { ...size },
  );
}
