import {
  explorePath,
  parseRepositoryInput,
  PARSE_ERROR_MESSAGES,
} from "@/lib/validation/repository-url";

export type RepositoryTarget =
  | { ok: true; href: string; owner: string; repo: string; ref?: string }
  | { ok: false; message: string };

/**
 * Turns whatever the user typed into an explorer URL, or a user-facing error.
 * A branch, tag or commit from `/tree/<ref>`, `/blob/<ref>` or `/commit/<ref>`
 * URLs is carried over as `?ref=` so the explorer analyzes that revision.
 */
export function resolveRepositoryTarget(input: string): RepositoryTarget {
  const parsed = parseRepositoryInput(input);
  if (!parsed.ok) return { ok: false, message: PARSE_ERROR_MESSAGES[parsed.reason] };
  const path = explorePath(parsed.owner, parsed.repo);
  const href = parsed.ref ? `${path}?${new URLSearchParams({ ref: parsed.ref }).toString()}` : path;
  return { ok: true, href, owner: parsed.owner, repo: parsed.repo, ref: parsed.ref };
}
