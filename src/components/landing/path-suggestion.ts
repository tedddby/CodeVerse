import { resolveRepositoryTarget } from "./repository-target";

export interface PathSuggestion {
  /** "owner/repo" as typed. */
  label: string;
  href: string;
}

/**
 * Guesses which repository a mistyped URL meant, e.g. "/facebook/react",
 * "/github.com/facebook/react/tree/main" or "/explore/facebook/react/extra".
 * Returns null when the path does not name a valid repository.
 */
export function suggestRepositoryFromPath(pathname: string): PathSuggestion | null {
  let segments = pathname.split("/").filter((segment) => segment !== "");
  if (segments[0] === "explore") segments = segments.slice(1);
  if (segments.length < 2) return null;
  // The parser decodes percent-escapes per segment and rejects malformed ones.
  const target = resolveRepositoryTarget(segments.join("/"));
  if (!target.ok) return null;
  return { label: `${target.owner}/${target.repo}`, href: target.href };
}
