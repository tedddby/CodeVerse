import { isValidOwner, isValidRef, isValidRepoName } from "@/lib/validation/repository-url";
import { SourceError } from "@/sources/types";

/**
 * URL-component validation for the GitHub data layer. This is the SSRF
 * boundary: every value interpolated into a GitHub URL passes through one of
 * these guards first, so a request can only ever target the configured GitHub
 * hosts with well-formed, percent-encoded path segments.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_API_REF_LENGTH = 255;

/** True for a full 40-character hexadecimal commit SHA (either case). */
export function isCommitSha(value: string): boolean {
  return COMMIT_SHA.test(value);
}

function invalid(message: string): SourceError {
  return new SourceError("INVALID_REPOSITORY", message);
}

export function assertOwner(owner: string): string {
  if (typeof owner !== "string" || !isValidOwner(owner)) {
    throw invalid("The repository owner is not a valid GitHub account name.");
  }
  return owner;
}

export function assertRepoName(repo: string): string {
  if (typeof repo !== "string" || !isValidRepoName(repo)) {
    throw invalid("The repository name is not valid.");
  }
  return repo;
}

/** Accepts a user-supplied branch/tag name (conservative subset) or a full commit SHA. */
export function assertUserRef(ref: string): string {
  if (typeof ref !== "string" || !(isValidRef(ref) || isCommitSha(ref))) {
    throw invalid("The requested branch, tag or commit is not a valid Git reference.");
  }
  return ref;
}

/** Validates a full commit SHA and returns it in canonical lower case. */
export function assertCommitSha(sha: string): string {
  if (typeof sha !== "string" || !isCommitSha(sha)) {
    throw invalid("Expected a full 40-character commit SHA.");
  }
  return sha.toLowerCase();
}

/**
 * Refs reported by the GitHub API itself (e.g. `default_branch`) may use
 * characters outside the conservative user-input subset (Unicode, "+", "@").
 * They are still untrusted, so they must be structurally safe: no control
 * characters, no empty or dot segments, bounded length. They are always
 * percent-encoded per segment before use.
 */
export function isSafeApiRef(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > MAX_API_REF_LENGTH) return false;
  if (isValidRef(ref)) return true;
  if (CONTROL_CHARACTERS.test(ref) || !ref.isWellFormed() || ref.includes("\\")) return false;
  return ref.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Percent-encodes a ref for use in a URL path, keeping "/" separators. */
export function encodeRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/** "/repos/{owner}/{repo}" with both components validated and encoded. */
export function repoApiPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(assertOwner(owner))}/${encodeURIComponent(assertRepoName(repo))}`;
}
