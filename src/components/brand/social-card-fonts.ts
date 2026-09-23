import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SOCIAL_CARD_FONT_FAMILY } from "./social-card";

/**
 * Server-only font loading for `ImageResponse` artwork (Open Graph images, app
 * icons). Passing `fonts` replaces the default font bundled with `next/og`, so
 * every weight the social card uses is loaded here. Fonts are read from the
 * installed `geist` package at build time (metadata images are statically
 * generated). Missing files are skipped; when nothing loads, callers omit the
 * `fonts` option and `next/og` falls back to its bundled font.
 */

const GEIST_FONT_DIR = join(process.cwd(), "node_modules", "geist", "dist", "fonts");

export interface SocialCardFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
}

async function readFont(relativePath: string): Promise<Buffer | null> {
  try {
    return await readFile(join(GEIST_FONT_DIR, relativePath));
  } catch {
    return null;
  }
}

export async function loadSocialCardFonts(): Promise<SocialCardFont[]> {
  const [regular, semiBold, mono] = await Promise.all([
    readFont(join("geist-sans", "Geist-Regular.ttf")),
    readFont(join("geist-sans", "Geist-SemiBold.ttf")),
    readFont(join("geist-mono", "GeistMono-Regular.ttf")),
  ]);
  const fonts: SocialCardFont[] = [];
  if (regular) {
    fonts.push({ name: SOCIAL_CARD_FONT_FAMILY.sans, data: regular, weight: 400, style: "normal" });
  }
  if (semiBold) {
    fonts.push({
      name: SOCIAL_CARD_FONT_FAMILY.sans,
      data: semiBold,
      weight: 600,
      style: "normal",
    });
  }
  if (mono) {
    fonts.push({ name: SOCIAL_CARD_FONT_FAMILY.mono, data: mono, weight: 400, style: "normal" });
  }
  return fonts;
}
