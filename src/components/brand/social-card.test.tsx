import { describe, expect, it } from "vitest";
import AppleIcon, { size as appleIconSize } from "@/app/apple-icon";
import OpenGraphImage, { alt, contentType, size } from "@/app/opengraph-image";
import { siteConfig } from "@/config/site";
import { SOCIAL_CARD_FONT_FAMILY, SOCIAL_CARD_SIZE } from "./social-card";
import { loadSocialCardFonts } from "./social-card-fonts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function readPng(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(bytes.buffer);
  return {
    signature: [...bytes.slice(0, 8)],
    // IHDR chunk: width and height are big-endian at offsets 16 and 20.
    width: view.getUint32(16),
    height: view.getUint32(20),
    byteLength: bytes.byteLength,
  };
}

describe("loadSocialCardFonts", () => {
  it("loads Geist regular, semibold and mono from the installed package", async () => {
    const fonts = await loadSocialCardFonts();
    expect(fonts.map(({ name, weight }) => `${name}:${weight}`)).toEqual([
      `${SOCIAL_CARD_FONT_FAMILY.sans}:400`,
      `${SOCIAL_CARD_FONT_FAMILY.sans}:600`,
      `${SOCIAL_CARD_FONT_FAMILY.mono}:400`,
    ]);
    for (const font of fonts) expect(font.data.byteLength).toBeGreaterThan(10_000);
  });
});

describe("site-wide Open Graph image", () => {
  it("declares the standard 1200x630 PNG metadata", () => {
    expect(size).toEqual(SOCIAL_CARD_SIZE);
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain(siteConfig.headline);
  });

  it("renders a real PNG of the declared size (Satori accepts the markup)", async () => {
    const response = await OpenGraphImage();
    expect(response.headers.get("content-type")).toContain("image/png");
    const png = await readPng(response);
    expect(png.signature).toEqual(PNG_SIGNATURE);
    expect({ width: png.width, height: png.height }).toEqual(size);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });
});

describe("apple touch icon", () => {
  it("renders a 180x180 PNG", async () => {
    const png = await readPng(AppleIcon());
    expect(png.signature).toEqual(PNG_SIGNATURE);
    expect({ width: png.width, height: png.height }).toEqual(appleIconSize);
  });
});
