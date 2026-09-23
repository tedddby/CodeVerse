import { DEFAULT_LIMITS } from "@/lib/config/limits";

/**
 * Repository path hygiene shared by every ingestion provider.
 *
 * Paths reported by a provider (tree listings, commit file lists, archive
 * entries) are untrusted. Before a path reaches the graph, a URL or a cache key
 * it must pass `sanitizeRepositoryPath`, which rejects anything that could be
 * interpreted differently by a filesystem, a URL parser or the UI:
 *
 * - empty strings and paths longer than `maxLength` UTF-16 code units,
 * - C0 control characters (U+0000–U+001F) and DEL (U+007F),
 * - lone surrogates (not representable in UTF-8 / not URL-encodable),
 * - absolute paths (leading "/"),
 * - empty segments ("a//b", trailing "/") and dot segments ("." / ".."),
 *   including their percent-encoded forms, which URL parsers normalize.
 *
 * Accepted paths are returned unchanged (never normalized) so they keep
 * addressing the exact same object on the provider.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
/** "." / ".." literally or percent-encoded ("%2e", "%2E%2e", ".%2e", ...). */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/** Returns the path when it is safe to use, or `null` when it must be rejected. */
export function sanitizeRepositoryPath(
  path: string,
  maxLength: number = DEFAULT_LIMITS.maxPathLength,
): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > maxLength) return null;
  if (CONTROL_CHARACTERS.test(path) || !path.isWellFormed()) return null;
  if (path.startsWith("/")) return null;
  for (const segment of path.split("/")) {
    if (segment.length === 0 || DOT_SEGMENT.test(segment)) return null;
  }
  return path;
}

/**
 * Percent-encodes a sanitized repository path segment by segment, keeping "/"
 * as the separator. Callers must sanitize first; this function assumes a
 * well-formed string.
 */
export function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
