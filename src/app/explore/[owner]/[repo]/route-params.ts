import { isValidOwner, isValidRepoName } from "@/lib/validation/repository-url";

/**
 * Decodes and validates the `[owner]/[repo]` segments. Returns null for
 * anything that is not a syntactically valid GitHub owner/repository, so the
 * page can 404 before any network request is made.
 */
export function parseRepositoryParams(params: {
  owner: string;
  repo: string;
}): { owner: string; repo: string } | null {
  const owner = safeDecode(params.owner);
  const repo = safeDecode(params.repo);
  if (owner === null || repo === null) return null;
  if (!isValidOwner(owner) || !isValidRepoName(repo)) return null;
  return { owner, repo };
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
