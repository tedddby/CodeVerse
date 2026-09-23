import type {
  SourceErrorCode,
  SourceErrorResponse,
  SourceFileResponse,
} from "@/analysis/source-protocol";
import { detectLanguage } from "@/lib/languages/registry";
import { formatBytes } from "@/lib/utils/format";
import { countLines } from "@/parser/lines";
import { isSourceError, type SourceFileResult } from "@/sources/types";
import { jsonResponse, retryAfterFromIso } from "./http";

/**
 * Response mapping for `GET /api/source/{owner}/{repo}`: file reads and
 * failures become `SourceFileResponse` / `SourceErrorResponse` bodies with
 * the matching HTTP status and cache policy. Error copy is authored here and
 * never includes upstream messages.
 */

/** Cache policy of successful reads: immutable for a commit SHA, short for branch/tag names. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const SHORT_CACHE = "public, max-age=60, s-maxage=60";

const COPY: Record<SourceErrorCode, { title: string; message: string }> = {
  INVALID_REQUEST: {
    title: "This file can't be requested.",
    message: "The repository, commit or file path is not valid.",
  },
  NOT_FOUND: {
    title: "File not found.",
    message: "The file does not exist at this commit.",
  },
  BINARY: {
    title: "Binary file.",
    message: "This file isn't text, so there's no source to display.",
  },
  TOO_LARGE: {
    title: "File too large to display.",
    message: "Open it on GitHub to view the full content.",
  },
  RATE_LIMITED: {
    title: "GitHub API rate limit reached.",
    message: "Source can't be loaded right now. Try again when the limit resets.",
  },
  UPSTREAM_ERROR: {
    title: "GitHub is having trouble right now.",
    message: "The file couldn't be loaded from GitHub. Please try again in a moment.",
  },
  INTERNAL: {
    title: "Something went wrong loading this file.",
    message: "Please try again.",
  },
};

const STATUS: Record<SourceErrorCode, number> = {
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  BINARY: 415,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export function sourceErrorResponse(
  code: SourceErrorCode,
  options: { message?: string; headers?: Record<string, string> } = {},
): Response {
  const copy = COPY[code];
  const body: SourceErrorResponse = {
    error: { code, title: copy.title, message: options.message ?? copy.message },
  };
  return jsonResponse(body, STATUS[code], options.headers);
}

export interface SourceReadContext {
  path: string;
  /** Commit SHA the file was read from. */
  sha: string;
  /** Whether the request pinned a full commit SHA (the answer can never change). */
  immutable: boolean;
  maxBytes: number;
}

/** Maps a raw file read to the viewer response. */
export function sourceFileResponse(result: SourceFileResult, context: SourceReadContext): Response {
  switch (result.kind) {
    case "text": {
      const body: SourceFileResponse = {
        path: context.path,
        ref: context.sha,
        size: result.size,
        content: result.content,
        language: detectLanguage(context.path).id,
        lines: countLines(result.content),
      };
      return jsonResponse(body, 200, {
        "Cache-Control": context.immutable ? IMMUTABLE_CACHE : SHORT_CACHE,
      });
    }
    case "binary":
      return sourceErrorResponse("BINARY");
    case "too-large":
      return sourceErrorResponse("TOO_LARGE", {
        message: `Files larger than ${formatBytes(context.maxBytes)} can't be shown here. Open it on GitHub to view the full content.`,
      });
    case "missing":
      return sourceErrorResponse("NOT_FOUND");
  }
}

/** Maps a failure while resolving the ref or reading the file. */
export function sourceFailureResponse(error: unknown, now: number = Date.now()): Response {
  if (!isSourceError(error)) return sourceErrorResponse("INTERNAL");
  switch (error.code) {
    case "RATE_LIMITED": {
      const retryAfter = retryAfterFromIso(error.retryAt, now);
      return sourceErrorResponse("RATE_LIMITED", {
        headers: retryAfter ? { "Retry-After": retryAfter } : {},
      });
    }
    case "INVALID_REPOSITORY":
      return sourceErrorResponse("INVALID_REQUEST");
    case "NOT_FOUND":
    case "PRIVATE_OR_INACCESSIBLE":
    case "EMPTY_REPOSITORY":
      return sourceErrorResponse("NOT_FOUND", {
        message: "The repository or file could not be found, or is not public.",
      });
    case "REF_NOT_FOUND":
      return sourceErrorResponse("NOT_FOUND", {
        message: "The requested branch, tag or commit does not exist in this repository.",
      });
    case "UNAUTHORIZED":
    case "UPSTREAM_ERROR":
    case "INVALID_RESPONSE":
    case "NETWORK_ERROR":
    case "TIMEOUT":
    case "ABORTED":
      return sourceErrorResponse("UPSTREAM_ERROR");
  }
}
