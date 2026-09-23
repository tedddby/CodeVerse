/**
 * troika-three-text ships its typings under dist/types without wiring them to
 * the package entry point. Only the API CodeVerse calls directly is declared.
 */
declare module "troika-three-text" {
  export interface TextBuilderConfig {
    /** Run typesetting in a Web Worker (default true). */
    useWorker?: boolean;
    /** Base URL of the unicode-font-resolver data used for glyph fallback (defaults to a CDN). */
    unicodeFontsURL?: string | null;
    /** Default font URL when a Text instance sets none. */
    defaultFontURL?: string | null;
    sdfGlyphSize?: number;
    sdfExponent?: number;
    sdfMargin?: number;
    textureWidth?: number;
  }

  export function configureTextBuilder(config: TextBuilderConfig): void;
}
