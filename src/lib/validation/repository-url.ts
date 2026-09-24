/**
 * Parses user input into a GitHub repository reference.
 *
 * Accepted forms (whitespace trimmed, case preserved):
 *   facebook/react
 *   github.com/facebook/react
 *   https://github.com/facebook/react
 *   https://github.com/facebook/react.git
 *   https://www.github.com/facebook/react/
 *   https://github.com/facebook/react/tree/main/packages/react
 *   https://github.com/facebook/react/blob/v18.2.0/README.md
 *   git@github.com:facebook/react.git
 *
 * Anything that is not unambiguously a github.com repository is rejected, which
 * also guarantees the server never fetches arbitrary user-supplied URLs (SSRF).
 */

/** GitHub usernames/orgs: alphanumerics and single hyphens, max 39 chars, no leading hyphen. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** Repository names: alphanumerics, ".", "-", "_", max 100 chars, not "." or "..". */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** Git refs we accept from URLs/query strings (conservative subset of git-check-ref-format). */
const REF_PATTERN = /^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._\-/]{1,200}$/;

const RESERVED_OWNERS = new Set([
  "about",
  "apps",
  "blog",
  "collections",
  "contact",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "team",
  "topics",
  "trending",
]);

export interface RepositoryReference {
  owner: string;
  repo: string;
  /** Branch/tag/SHA when the URL pointed into /tree/<ref> or /blob/<ref>. */
  ref?: string;
  /** Path inside the repository when the URL pointed at a directory or file. */
  path?: string;
}

export type ParseRepositoryResult =
  | ({ ok: true } & RepositoryReference)
  | {
      ok: false;
      reason: "empty" | "not-github" | "invalid-owner" | "invalid-repo" | "missing-repo";
    };

export function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner) && !RESERVED_OWNERS.has(owner.toLowerCase());
}

export function isValidRepoName(repo: string): boolean {
  return (
    REPO_PATTERN.test(repo) && repo !== "." && repo !== ".." && !repo.toLowerCase().endsWith(".git")
  );
}

export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}

function stripGitSuffix(repo: string): string {
  return repo.toLowerCase().endsWith(".git") ? repo.slice(0, -4) : repo;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRepositoryInput(rawInput: string): ParseRepositoryResult {
  const input = rawInput.trim();
  if (input === "") return { ok: false, reason: "empty" };
  if (input.length > 2_048) return { ok: false, reason: "not-github" };

  let pathPart: string;

  const sshMatch = /^git@github\.com:(.+)$/i.exec(input);
  if (sshMatch) {
    pathPart = sshMatch[1] ?? "";
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^(www\.)?github\.com\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return { ok: false, reason: "not-github" };
    }
    const host = url.hostname.toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      (host !== "github.com" && host !== "www.github.com")
    ) {
      return { ok: false, reason: "not-github" };
    }
    if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) {
      return { ok: false, reason: "not-github" };
    }
    pathPart = url.pathname;
  } else if (/^[^/\s:]+\/[^/\s:]+/.test(input) && !input.includes("://")) {
    pathPart = input;
  } else {
    return { ok: false, reason: "not-github" };
  }

  const segments = pathPart
    .split(/[?#]/)[0]!
    .split("/")
    .filter((segment) => segment !== "")
    .map(safeDecode);
  if (segments.some((segment) => segment === null)) return { ok: false, reason: "not-github" };
  const [owner, rawRepo, kind, ...rest] = segments as string[];

  if (!owner) return { ok: false, reason: "not-github" };
  if (!rawRepo) return { ok: false, reason: "missing-repo" };
  if (!isValidOwner(owner)) return { ok: false, reason: "invalid-owner" };
  const repo = stripGitSuffix(rawRepo);
  if (!isValidRepoName(repo)) return { ok: false, reason: "invalid-repo" };

  const result: { ok: true } & RepositoryReference = { ok: true, owner, repo };
  if ((kind === "tree" || kind === "blob" || kind === "commit") && rest.length > 0) {
    const [ref, ...pathSegments] = rest;
    if (ref && isValidRef(ref)) {
      result.ref = ref;
      const path = pathSegments.join("/");
      if (path && !pathSegments.some((segment) => segment === ".." || segment === "."))
        result.path = path;
    }
  }
  return result;
}

/** Canonical explorer URL path for a repository. */
export function explorePath(owner: string, repo: string): string {
  return `/explore/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export const PARSE_ERROR_MESSAGES: Record<
  Exclude<ParseRepositoryResult, { ok: true }>["reason"],
  string
> = {
  empty: "Paste a GitHub repository URL, like https://github.com/facebook/react.",
  "not-github": "That doesn't look like a GitHub repository URL.",
  "invalid-owner": "That GitHub owner name isn't valid.",
  "invalid-repo": "That repository name isn't valid.",
  "missing-repo": "Include the repository name, e.g. facebook/react.",
};
