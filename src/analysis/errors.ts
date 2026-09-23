import { ERROR_COPY, type AnalysisErrorCode, type AnalysisErrorPayload } from "@/analysis/protocol";
import { isSourceError, type SourceErrorCode } from "@/sources/types";
import { AnalysisBusyError } from "./concurrency";

/**
 * Maps failures to the user-facing error payload of the analysis protocol.
 *
 * Titles and messages always come from `ERROR_COPY` (or the small set of
 * server-side overrides below), never from the error itself: provider
 * messages, stack traces and anything that could carry a secret or an
 * internal detail stay in the server logs.
 */

const CODE_MAP: Record<SourceErrorCode, AnalysisErrorCode> = {
  INVALID_REPOSITORY: "INVALID_REPOSITORY",
  NOT_FOUND: "NOT_FOUND",
  PRIVATE_OR_INACCESSIBLE: "PRIVATE_OR_INACCESSIBLE",
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHORIZED: "UNAUTHORIZED",
  EMPTY_REPOSITORY: "EMPTY_REPOSITORY",
  REF_NOT_FOUND: "REF_NOT_FOUND",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  // A malformed provider answer is an upstream problem from the user's point of view.
  INVALID_RESPONSE: "UPSTREAM_ERROR",
  // Only reported when the server itself gave up (the client that aborted is gone).
  ABORTED: "TIMEOUT",
};

/**
 * `ERROR_COPY` is written from the browser's perspective. When the server
 * fails to reach GitHub, "check your connection" would be misleading.
 */
const SERVER_SIDE_COPY: Partial<Record<AnalysisErrorCode, { title: string; message: string }>> = {
  NETWORK_ERROR: {
    title: "Couldn't reach GitHub.",
    message: "The server could not connect to GitHub. Please try again in a moment.",
  },
};

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Builds the payload for a code, with the canonical copy. */
export function errorPayloadFor(code: AnalysisErrorCode, retryAt?: string): AnalysisErrorPayload {
  const copy = SERVER_SIDE_COPY[code] ?? ERROR_COPY[code];
  const payload: AnalysisErrorPayload = { code, title: copy.title, message: copy.message };
  if (isValidIsoDate(retryAt)) payload.retryAt = new Date(retryAt).toISOString();
  return payload;
}

/** Copy for a server that has no free analysis slot (reported as CLIENT_RATE_LIMITED). */
export const BUSY_COPY = {
  title: "CodeVerse is busy right now.",
  message: "Many repositories are being analyzed at the moment. Please try again in a minute.",
} as const;

/**
 * SourceError codes map to protocol codes with the canonical copy (plus
 * `retryAt` for rate limits); anything else is INTERNAL with generic copy.
 */
export function toErrorPayload(error: unknown): AnalysisErrorPayload {
  if (error instanceof AnalysisBusyError) {
    return { code: "CLIENT_RATE_LIMITED", title: BUSY_COPY.title, message: BUSY_COPY.message };
  }
  if (!isSourceError(error)) return errorPayloadFor("INTERNAL");
  const code = CODE_MAP[error.code] ?? "INTERNAL";
  return errorPayloadFor(code, code === "RATE_LIMITED" ? error.retryAt : undefined);
}
