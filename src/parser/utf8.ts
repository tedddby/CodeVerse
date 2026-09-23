/**
 * UTF-8 size helpers that work on JavaScript strings without allocating an
 * encoded copy (the parser must run in Node, browsers and workers alike).
 */

const BYTE_ORDER_MARK = 0xfeff;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Number of bytes `text` occupies when encoded as UTF-8. Lone surrogates count
 * as the 3-byte replacement character, matching `TextEncoder`.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      isHighSurrogate(code) &&
      index + 1 < text.length &&
      isLowSurrogate(text.charCodeAt(index + 1))
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * True when the UTF-8 encoding of `text` is larger than `maxBytes`. Answers
 * from the string length alone whenever possible: every UTF-16 code unit
 * encodes to between 1 and 3 bytes.
 */
export function exceedsUtf8Bytes(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) return true;
  if (text.length * 3 <= maxBytes) return false;
  return utf8ByteLength(text) > maxBytes;
}

/** Removes a leading byte order mark, which some grammars reject as a syntax error. */
export function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}
