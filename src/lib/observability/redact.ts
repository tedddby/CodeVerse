/**
 * Secret redaction for everything that leaves the process as a log line or a
 * metric attribute.
 *
 * Two complementary mechanisms:
 * - pattern-based masking of credential-shaped substrings (GitHub tokens,
 *   `Bearer` / `Basic` credentials, `token=` style query parameters), and of
 *   values stored under credential-like keys (`authorization`, `cookie`,
 *   `apiKey`, `githubToken`, ...);
 * - literal masking of secrets registered at startup (`registerSecret`), which
 *   also catches credentials that do not match any known format.
 *
 * `redactSecrets` never throws and never mutates its input: it returns a
 * JSON-safe deep copy (Errors become plain objects, cycles become
 * "[Circular]", BigInts become strings, functions and symbols are dropped).
 */

export const REDACTED = "[REDACTED]";

/** Classic, OAuth, user-to-server, server-to-server and refresh GitHub tokens. */
const GITHUB_TOKEN_PATTERN = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+/g;
/** Fine-grained personal access tokens. */
const GITHUB_PAT_PATTERN = /\bgithub_pat_[A-Za-z0-9_]+/g;
/** `Authorization: Bearer <credential>` / `Basic <credential>`. */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)(\s+)[^\s"',;]+/gi;
/** Credentials carried in URLs or form bodies (`?access_token=...&x=1`). */
const QUERY_SECRET_PATTERN =
  /([?&;]|\b)((?:access_token|refresh_token|id_token|token|client_secret|api_key|apikey|password|secret|sig|signature)=)[^&#\s"']+/gi;
/** `https://user:password@host` URL credentials. */
const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

/** Keys whose (string or structured) values are always masked. Matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|auth|password|passwd|pwd|secret|client_secret|private_key|privatekey)$|token$|secret$|password$|apikey$|api_key$|api-key$|credential|session_?id$/i;

/** Longest string kept in a log record; longer strings are truncated. */
const MAX_STRING_LENGTH = 8_192;
/** Nesting depth after which values are summarized. */
const MAX_DEPTH = 10;
/** Longest array kept; the rest is summarized. */
const MAX_ARRAY_ITEMS = 200;
/** Shortest literal secret that is registered (shorter values would mask ordinary text). */
const MIN_SECRET_LENGTH = 8;

const registeredSecrets = new Set<string>();

/**
 * Registers a literal secret (e.g. the configured `GITHUB_TOKEN`) so that every
 * occurrence is masked, whatever its format. Values shorter than 8 characters
 * are ignored because masking them would corrupt ordinary text.
 */
export function registerSecret(secret: string | undefined | null): void {
  const value = secret?.trim();
  if (value && value.length >= MIN_SECRET_LENGTH) registeredSecrets.add(value);
}

/** Removes every registered literal secret (tests only). */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/** Masks credential-shaped substrings and registered secrets in a string. */
export function redactString(value: string): string {
  let result = value;
  for (const secret of registeredSecrets) {
    if (result.includes(secret)) result = result.split(secret).join(REDACTED);
  }
  return result
    .replace(GITHUB_PAT_PATTERN, REDACTED)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(
      AUTH_SCHEME_PATTERN,
      (_match, scheme: string, space: string) => `${scheme}${space}${REDACTED}`,
    )
    .replace(
      QUERY_SECRET_PATTERN,
      (_match, prefix: string, name: string) => `${prefix}${name}${REDACTED}`,
    )
    .replace(URL_CREDENTIALS_PATTERN, (_match, scheme: string) => `${scheme}${REDACTED}@`);
}

/** Whether values stored under `key` must be masked. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}… (${value.length - MAX_STRING_LENGTH} more characters)`
    : value;
}

function isPlainValueForSensitiveKey(value: unknown): boolean {
  // Booleans, numbers and absent values carry no secret (e.g. `tokenConfigured: true`).
  return (
    value === null || value === undefined || typeof value === "boolean" || typeof value === "number"
  );
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case "string":
      return truncate(redactString(value));
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (value === null) return null;
  const object = value as object;
  if (seen.has(object)) return "[Circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(object) ? "[Array]" : "[Object]";
  seen.add(object);
  try {
    if (object instanceof Date)
      return Number.isNaN(object.getTime()) ? "Invalid Date" : object.toISOString();
    if (object instanceof URL) return redactString(object.href);
    if (object instanceof Error) return redactError(object, depth, seen);
    if (Array.isArray(object)) return redactArray(object, depth, seen);
    if (object instanceof Map) {
      const entries = [...object.entries()].map(([key, entry]) => [String(key), entry] as const);
      return redactEntries(entries, depth, seen);
    }
    if (object instanceof Set) return redactArray([...object], depth, seen);
    if (ArrayBuffer.isView(object))
      return `[${object.constructor.name} ${object.byteLength} bytes]`;
    if (typeof Headers !== "undefined" && object instanceof Headers) {
      return redactEntries([...object.entries()], depth, seen);
    }
    return redactEntries(Object.entries(object), depth, seen);
  } finally {
    // Siblings may legitimately share a reference; only ancestors count as cycles.
    seen.delete(object);
  }
}

function redactArray(items: readonly unknown[], depth: number, seen: WeakSet<object>): unknown[] {
  const kept = items.slice(0, MAX_ARRAY_ITEMS).map((item) => {
    const redacted = redactValue(item, depth + 1, seen);
    return redacted === undefined ? null : redacted;
  });
  if (items.length > MAX_ARRAY_ITEMS) kept.push(`… ${items.length - MAX_ARRAY_ITEMS} more items`);
  return kept;
}

function redactEntries(
  entries: ReadonlyArray<readonly [string, unknown]>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (isSensitiveKey(key) && !isPlainValueForSensitiveKey(entry)) {
      output[key] = REDACTED;
      continue;
    }
    const redacted = redactValue(entry, depth + 1, seen);
    if (redacted !== undefined) output[key] = redacted;
  }
  return output;
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: error.name,
    message: truncate(redactString(error.message)),
  };
  // Own enumerable properties (code, status, retryAt, ...) are copied, redacted.
  for (const [key, value] of Object.entries(error)) {
    if (key in output || key === "stack" || key === "cause") continue;
    if (isSensitiveKey(key) && !isPlainValueForSensitiveKey(value)) {
      output[key] = REDACTED;
      continue;
    }
    const redacted = redactValue(value, depth + 1, seen);
    if (redacted !== undefined) output[key] = redacted;
  }
  if (typeof error.stack === "string") output.stack = truncate(redactString(error.stack));
  if (error.cause !== undefined) output.cause = redactValue(error.cause, depth + 1, seen);
  return output;
}

/**
 * Returns a JSON-safe deep copy of `value` with every secret masked.
 * Never throws and never mutates the input.
 */
export function redactSecrets(value: unknown): unknown {
  try {
    return redactValue(value, 0, new WeakSet());
  } catch {
    return "[Unserializable]";
  }
}
