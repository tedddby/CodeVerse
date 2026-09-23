import { collapseWhitespace } from "./nodes";

/** Maximum signature length, including the trailing ellipsis when clipped. */
export const MAX_SIGNATURE_LENGTH = 160;

/** Characters read from the source for one signature; heads longer than this are clipped. */
const SCAN_LIMIT = 1_000;

const ELLIPSIS = "…";

/** Body openers and terminators that end a declaration head: `{`, `:`, `=>`, `=`, `;`. */
const TRAILING_OPENER = /\s*(?:=>|[{:=;])$/;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Clips `text` to {@link MAX_SIGNATURE_LENGTH} characters with a trailing ellipsis. */
export function clipSignature(text: string, forceEllipsis = false): string {
  if (!forceEllipsis && text.length <= MAX_SIGNATURE_LENGTH) return text;
  let cut = Math.min(text.length, MAX_SIGNATURE_LENGTH - ELLIPSIS.length);
  // Never split a surrogate pair.
  if (cut > 0 && cut < text.length && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}${ELLIPSIS}`;
}

/**
 * Builds a single-line signature from `source[start, end)`: whitespace is
 * collapsed, a trailing body opener is removed and the result is clipped.
 * `prefix` is prepended (e.g. "const", "type" for declarations whose keyword
 * lives on a parent node). Returns undefined for empty heads.
 */
export function signatureFromRange(
  source: string,
  start: number,
  end: number,
  prefix?: string,
): string | undefined {
  if (end <= start) return prefix;
  const clipped = end - start > SCAN_LIMIT;
  let head = collapseWhitespace(source.slice(start, clipped ? start + SCAN_LIMIT : end));
  if (!clipped) {
    // Strip at most two openers, e.g. "=> {" is never produced but "): =" could be.
    for (let pass = 0; pass < 2 && TRAILING_OPENER.test(head); pass += 1) {
      head = head.replace(TRAILING_OPENER, "");
    }
  }
  const text = prefix ? `${prefix} ${head}`.trim() : head;
  if (text.length === 0) return undefined;
  return clipSignature(text, clipped);
}
