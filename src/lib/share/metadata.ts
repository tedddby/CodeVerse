import type { RepositoryInfo } from "@/graph/model/types";
import { formatCompact } from "@/lib/utils/format";

/**
 * Helpers for per-repository page metadata and social preview cards.
 * Repository descriptions are untrusted provider data: they are only ever
 * emitted as plain text (meta tags, image text), never as markup.
 */

/** The repository fields metadata needs; satisfied by `RepositorySummary` from the GitHub source. */
export type RepositoryMetadataSource = Pick<RepositoryInfo, "fullName" | "stars" | "forks"> &
  Partial<Pick<RepositoryInfo, "description" | "language">>;

/**
 * Runs `task` with an AbortSignal that fires after `timeoutMs`, resolving to
 * null on timeout or on ANY error. Never rejects: callers use it for optional
 * enrichment that must not break a page.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      resolve(null);
    }, timeoutMs);
  });
  try {
    const guarded = Promise.resolve()
      .then(() => task(controller.signal))
      .catch(() => null);
    return await Promise.race([guarded, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Collapses whitespace and strips control characters. */
export function normalizeInlineText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

/** Truncates at a word boundary when possible, appending an ellipsis. */
export function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  const keep = Math.max(1, maxLength - 1);
  const cut = characters.slice(0, keep).join("");
  // Cutting right before a space already ends on a word; otherwise back up to the last space.
  const endsOnWord = characters[keep] === " ";
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = !endsOnWord && lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * Removes emoji and pictographs. The social card renderer would otherwise
 * fetch emoji artwork from a CDN at render time, which can fail or stall.
 */
export function stripEmoji(value: string): string {
  return (
    value
      .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1f3fb}-\u{1f3ff}‍︎️⃣]/gu, "")
      // GitHub emoji shortcodes such as ":rocket:" (only as standalone words).
      .replace(/(^|\s):[a-z0-9_+-]{2,40}:(?=\s|$)/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** "A declarative UI library · 238.4K stars · TypeScript" (description truncated to ~180 characters). */
export function describeRepositoryForMetadata(summary: RepositoryMetadataSource): string {
  const parts: string[] = [];
  const description = summary.description ? normalizeInlineText(summary.description) : "";
  if (description) parts.push(truncateText(description, 180));
  parts.push(`${formatCompact(summary.stars)} ${summary.stars === 1 ? "star" : "stars"}`);
  if (summary.language) parts.push(normalizeInlineText(summary.language));
  return parts.join(" · ");
}

/** Fallback description when repository metadata is unavailable. */
export function genericRepositoryDescription(fullName: string): string {
  return `Fly through ${fullName} as an interactive 3D universe: architecture, dependencies, history and code.`;
}
