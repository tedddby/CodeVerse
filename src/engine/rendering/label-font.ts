import { configureTextBuilder } from "troika-three-text";

/**
 * Font and typesetting configuration for in-world labels (troika SDF text).
 *
 * - The label font is self-hosted (Geist Mono, SIL OFL 1.1 — see
 *   public/fonts/GeistMono-LICENSE.txt), so rendering never contacts a
 *   third-party CDN. Override with NEXT_PUBLIC_LABEL_FONT_URL (.ttf/.otf/.woff).
 * - Typesetting runs on the main thread: troika's worker bootstraps itself via
 *   importScripts(blob:), which the Content Security Policy forbids, and a
 *   few dozen labels are cheap to lay out anyway.
 * - Troika's fallback resolver for glyphs missing from the font (e.g. CJK
 *   names) is pointed at our own origin instead of its default CDN. No
 *   fallback data is served there, so such glyphs render blank rather than
 *   leaking requests to a third party.
 */
export const LABEL_FONT_URL: string =
  process.env.NEXT_PUBLIC_LABEL_FONT_URL || "/fonts/GeistMono-Medium.ttf";

let configured = false;

/** Applies the typesetting configuration once, before the first label renders. */
export function configureLabelText(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;
  configureTextBuilder({
    useWorker: false,
    defaultFontURL: LABEL_FONT_URL,
    unicodeFontsURL: "/fonts/unicode-fallback-disabled",
  });
}

configureLabelText();
