/**
 * Font used by in-world labels (troika SDF text).
 *
 * When unset, troika resolves glyphs with its built-in Unicode font resolver
 * (Noto families served from cdn.jsdelivr.net), which also covers non-Latin
 * directory and symbol names. Deployments that must not load third-party
 * assets (strict CSP, offline) can self-host a .ttf/.otf/.woff (not .woff2)
 * and point NEXT_PUBLIC_LABEL_FONT_URL at it, e.g. "/fonts/GeistMono-Medium.ttf";
 * troika still falls back to the resolver for glyphs the font lacks.
 */
export const LABEL_FONT_URL: string | undefined =
  process.env.NEXT_PUBLIC_LABEL_FONT_URL || undefined;
