/**
 * Helpers for untrusted strings coming from the provider (commit messages,
 * author names, upstream error messages). They never interpret the content;
 * they only make it safe to store and render as plain text.
 */

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const WHITESPACE_RUN = /\s+/g;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Removes control characters and lone surrogates, collapses whitespace, trims and truncates. */
export function cleanSingleLine(value: string, maxLength: number): string {
  const cleaned = value
    .replace(LONE_SURROGATE, REPLACEMENT_CHARACTER)
    .replace(CONTROL_CHARACTERS, "")
    .replace(WHITESPACE_RUN, " ")
    .trim();
  return truncate(cleaned, maxLength);
}

/** First line of a (commit) message, cleaned and truncated. */
export function firstLine(message: string, maxLength: number): string {
  const newline = message.search(/\r?\n|\r/);
  return cleanSingleLine(newline === -1 ? message : message.slice(0, newline), maxLength);
}

/** Truncates without splitting a surrogate pair, appending an ellipsis when shortened. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  let end = Math.max(0, maxLength - 1);
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

/** Replaces every occurrence of `secret` with a placeholder. No-op without a secret. */
export function redactSecret(value: string, secret: string | undefined): string {
  if (!secret) return value;
  return value.split(secret).join("[redacted]");
}

/** Parses an ISO-8601 date and returns it normalized to UTC, or undefined when invalid. */
export function normalizeIsoDate(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
