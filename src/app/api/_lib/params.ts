import { isCommitSha } from "@/github/validation";
import { isValidOwner, isValidRef, isValidRepoName } from "@/lib/validation/repository-url";

/**
 * Validation of API route input. Everything that reaches the GitHub layer is
 * checked here first, so malformed input never costs an upstream request.
 */

export interface RepositoryParams {
  owner: string;
  repo: string;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Decodes and validates the `[owner]/[repo]` segments; null when either is not a valid GitHub name. */
export function parseRepositoryParams(params: {
  owner: string;
  repo: string;
}): RepositoryParams | null {
  const owner = safeDecode(params.owner);
  const repo = safeDecode(params.repo);
  if (owner === null || repo === null) return null;
  if (!isValidOwner(owner) || !isValidRepoName(repo)) return null;
  return { owner, repo };
}

/**
 * Parses an optional `ref` query parameter: absent or empty means "default
 * branch" (undefined); otherwise it must be a safe branch/tag name or a full
 * commit SHA (null when invalid).
 */
export function parseOptionalRef(value: string | null): string | undefined | null {
  if (value === null || value === "") return undefined;
  return isValidRef(value) || isCommitSha(value) ? value : null;
}
