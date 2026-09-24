/**
 * Characters that change how text is displayed without being visible
 * themselves: bidirectional controls ("Trojan Source", CVE-2021-42574), bidi
 * marks, and zero-width or blank characters. Source code and repository paths
 * are untrusted, so the UI reveals each one as a visible marker instead of
 * letting it reorder or hide text. Pure and framework-free.
 */

export type HiddenCharacterKind = "bidi" | "invisible";

export interface HiddenCharacter {
  /** UTF-16 offset in the scanned text. */
  index: number;
  codePoint: number;
  /** Unicode name in sentence case, e.g. "Right-to-left override". */
  name: string;
  kind: HiddenCharacterKind;
}

const CHARACTERS: ReadonlyMap<number, { name: string; kind: HiddenCharacterKind }> = new Map([
  [0x061c, { name: "Arabic letter mark", kind: "bidi" }],
  [0x115f, { name: "Hangul choseong filler", kind: "invisible" }],
  [0x1160, { name: "Hangul jungseong filler", kind: "invisible" }],
  [0x200b, { name: "Zero width space", kind: "invisible" }],
  [0x200c, { name: "Zero width non-joiner", kind: "invisible" }],
  [0x200d, { name: "Zero width joiner", kind: "invisible" }],
  [0x200e, { name: "Left-to-right mark", kind: "bidi" }],
  [0x200f, { name: "Right-to-left mark", kind: "bidi" }],
  [0x2028, { name: "Line separator", kind: "invisible" }],
  [0x2029, { name: "Paragraph separator", kind: "invisible" }],
  [0x202a, { name: "Left-to-right embedding", kind: "bidi" }],
  [0x202b, { name: "Right-to-left embedding", kind: "bidi" }],
  [0x202c, { name: "Pop directional formatting", kind: "bidi" }],
  [0x202d, { name: "Left-to-right override", kind: "bidi" }],
  [0x202e, { name: "Right-to-left override", kind: "bidi" }],
  [0x2060, { name: "Word joiner", kind: "invisible" }],
  [0x2061, { name: "Function application", kind: "invisible" }],
  [0x2062, { name: "Invisible times", kind: "invisible" }],
  [0x2063, { name: "Invisible separator", kind: "invisible" }],
  [0x2064, { name: "Invisible plus", kind: "invisible" }],
  [0x2066, { name: "Left-to-right isolate", kind: "bidi" }],
  [0x2067, { name: "Right-to-left isolate", kind: "bidi" }],
  [0x2068, { name: "First strong isolate", kind: "bidi" }],
  [0x2069, { name: "Pop directional isolate", kind: "bidi" }],
  [0x3164, { name: "Hangul filler", kind: "invisible" }],
  [0xfeff, { name: "Zero width no-break space", kind: "invisible" }],
  [0xffa0, { name: "Halfwidth Hangul filler", kind: "invisible" }],
]);

/** Every character in `CHARACTERS`; joiners are then checked in context. */
const CANDIDATE_CLASS =
  "[\\u061C\\u115F\\u1160\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\u3164\\uFEFF\\uFFA0]";
const CANDIDATE = new RegExp(CANDIDATE_CLASS);

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
// Alternations rather than character classes: some Chromium builds fail to match an
// astral code point (an emoji) against a property-escape class anchored with `$`.
const EMOJI_BEFORE = /(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Variation_Selector})$/u;
const EMOJI_AFTER = /^\p{Extended_Pictographic}/u;
/** A combining mark or a letter of a non-Latin script (Arabic, Persian, Indic, ...). */
const JOINING_SCRIPT_BEFORE = /(?:\p{M}|(?!\p{Script=Latin})\p{L})$/u;
const JOINING_SCRIPT_AFTER = /^(?:\p{M}|(?!\p{Script=Latin})\p{L})/u;

/**
 * Joiners are ordinary text inside emoji sequences (woman + ZWJ + laptop) and
 * between letters of scripts that need them (Persian, Devanagari). Elsewhere,
 * for example inside an ASCII identifier, they only hide a difference.
 */
function isOrdinaryJoiner(text: string, index: number, codePoint: number): boolean {
  if (codePoint !== ZWNJ && codePoint !== ZWJ) return false;
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + 1, index + 3);
  if (codePoint === ZWJ && EMOJI_BEFORE.test(before) && EMOJI_AFTER.test(after)) return true;
  return JOINING_SCRIPT_BEFORE.test(before) && JOINING_SCRIPT_AFTER.test(after);
}

/** True when `text` contains at least one hidden character (cheap for the common case). */
export function hasHiddenCharacters(text: string): boolean {
  return findHiddenCharacters(text).length > 0;
}

/** Hidden characters of `text` in order of appearance. */
export function findHiddenCharacters(text: string): HiddenCharacter[] {
  if (!CANDIDATE.test(text)) return [];
  const found: HiddenCharacter[] = [];
  const pattern = new RegExp(CANDIDATE_CLASS, "g");
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const codePoint = text.charCodeAt(match.index);
    const info = CHARACTERS.get(codePoint);
    if (!info || isOrdinaryJoiner(text, match.index, codePoint)) continue;
    found.push({ index: match.index, codePoint, name: info.name, kind: info.kind });
  }
  return found;
}

export interface HiddenCharacterSummary {
  bidi: number;
  invisible: number;
  /** The first one in the text, e.g. to show what its marker looks like. */
  first: HiddenCharacter;
}

/** Counts per kind, or null when `text` has none. */
export function summarizeHiddenCharacters(text: string): HiddenCharacterSummary | null {
  const found = findHiddenCharacters(text);
  const [first] = found;
  if (!first) return null;
  const bidi = found.filter((character) => character.kind === "bidi").length;
  return { bidi, invisible: found.length - bidi, first };
}

/** "U+202E". */
export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export type TextSegment =
  { kind: "text"; text: string } | { kind: "hidden"; character: HiddenCharacter };

/** Splits `text` into plain runs and the hidden characters between them. */
export function splitHiddenCharacters(text: string): TextSegment[] {
  const hidden = findHiddenCharacters(text);
  if (hidden.length === 0) return text ? [{ kind: "text", text }] : [];
  const segments: TextSegment[] = [];
  let start = 0;
  for (const character of hidden) {
    if (character.index > start)
      segments.push({ kind: "text", text: text.slice(start, character.index) });
    segments.push({ kind: "hidden", character });
    start = character.index + 1;
  }
  if (start < text.length) segments.push({ kind: "text", text: text.slice(start) });
  return segments;
}

/**
 * `text` with every hidden character replaced by a visible "[U+202E]" marker,
 * for plain-string sinks: attributes, accessible names and canvas labels.
 */
export function escapeHiddenCharacters(text: string): string {
  const hidden = findHiddenCharacters(text);
  if (hidden.length === 0) return text;
  let result = "";
  let start = 0;
  for (const character of hidden) {
    result += `${text.slice(start, character.index)}[${codePointLabel(character.codePoint)}]`;
    start = character.index + 1;
  }
  return result + text.slice(start);
}
