import { SourceError, isSourceError, type SourceErrorCode } from "@/sources/types";
import { parseRetryAfterMs } from "./rate-limit";
import { cleanSingleLine, redactSecret } from "./text";

/**
 * Maps GitHub HTTP failures to `SourceError`s.
 *
 * Messages are authored here and never include URLs, headers or credentials.
 * GitHub's own error text is kept separately (sanitized, redacted, truncated) in
 * `upstreamMessage` so callers can distinguish e.g. the different kinds of 403.
 */

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_UPSTREAM_MESSAGE_LENGTH = 300;
const SECONDARY_RATE_LIMIT = /secondary rate limit|abuse detection/i;

export interface GitHubApiErrorOptions {
  status?: number;
  retryAt?: string;
  cause?: unknown;
  upstreamMessage?: string;
  /** Wait suggested by `retry-after` for secondary rate limits, in milliseconds. */
  retryAfterMs?: number;
}

/** A `SourceError` produced from a GitHub HTTP response. */
export class GitHubApiError extends SourceError {
  /** GitHub's error message for the response, sanitized. */
  readonly upstreamMessage?: string;
  /** Present for secondary rate limits that announced a `retry-after`. */
  readonly retryAfterMs?: number;

  constructor(code: SourceErrorCode, message: string, options: GitHubApiErrorOptions = {}) {
    super(code, message, {
      status: options.status,
      retryAt: options.retryAt,
      cause: options.cause,
    });
    this.name = "GitHubApiError";
    this.upstreamMessage = options.upstreamMessage;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface ResponseErrorInput {
  status: number;
  headers: Headers;
  /** Response body (possibly truncated); may be empty. */
  bodyText: string;
  now: number;
  /** Secret to scrub from anything derived from the response. */
  secret?: string;
}

/** Extracts and sanitizes the `message` field of a GitHub JSON error body. */
/** GitHubApiError check that survives duplicated module copies (see `isSourceError`). */
export function isGitHubApiError(value: unknown): value is GitHubApiError {
  return (
    value instanceof GitHubApiError || (isSourceError(value) && value.name === "GitHubApiError")
  );
}

export function readUpstreamMessage(bodyText: string, secret?: string): string | undefined {
  if (!bodyText) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("message" in parsed)) return undefined;
  const message = parsed.message;
  if (typeof message !== "string") return undefined;
  const cleaned = cleanSingleLine(redactSecret(message, secret), MAX_UPSTREAM_MESSAGE_LENGTH);
  return cleaned || undefined;
}

function resetToIso(headers: Headers): string | undefined {
  const raw = headers.get("x-ratelimit-reset")?.trim();
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  return new Date(Number(raw) * 1000).toISOString();
}

/** Builds the error for a non-success GitHub API response. */
export function mapResponseError(input: ResponseErrorInput): GitHubApiError {
  const { status, headers, now } = input;
  const upstreamMessage = readUpstreamMessage(input.bodyText, input.secret);
  const base = { status, upstreamMessage };

  if (status === 403 || status === 429) {
    if (headers.get("x-ratelimit-remaining")?.trim() === "0") {
      const retryAt =
        resetToIso(headers) ?? new Date(now + DEFAULT_RATE_LIMIT_WAIT_MS).toISOString();
      return new GitHubApiError("RATE_LIMITED", "The GitHub API rate limit is exhausted.", {
        ...base,
        retryAt,
      });
    }
    const retryAfterMs = parseRetryAfterMs(headers, now);
    const secondary = upstreamMessage !== undefined && SECONDARY_RATE_LIMIT.test(upstreamMessage);
    if (retryAfterMs !== undefined || secondary || status === 429) {
      const waitMs = retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
      return new GitHubApiError("RATE_LIMITED", "GitHub is temporarily throttling requests.", {
        ...base,
        retryAt: new Date(now + waitMs).toISOString(),
        retryAfterMs,
      });
    }
    return new GitHubApiError(
      "PRIVATE_OR_INACCESSIBLE",
      "GitHub denied access to this resource.",
      base,
    );
  }

  switch (status) {
    case 401:
      return new GitHubApiError(
        "UNAUTHORIZED",
        "GitHub rejected the configured access token.",
        base,
      );
    case 404:
    case 410:
      return new GitHubApiError("NOT_FOUND", "GitHub could not find the requested resource.", base);
    case 409:
      return new GitHubApiError("EMPTY_REPOSITORY", "The repository has no commits yet.", base);
    case 422:
      // GitHub answers 422 on GET endpoints for references it cannot resolve
      // ("No commit found for SHA"). Ref resolution refines this further.
      return new GitHubApiError(
        "NOT_FOUND",
        "GitHub could not resolve the requested object.",
        base,
      );
    case 451:
      return new GitHubApiError(
        "PRIVATE_OR_INACCESSIBLE",
        "This repository is unavailable for legal reasons.",
        base,
      );
    default:
      return new GitHubApiError(
        "UPSTREAM_ERROR",
        status >= 500
          ? `GitHub returned a server error (HTTP ${status}).`
          : `GitHub returned an unexpected response (HTTP ${status}).`,
        base,
      );
  }
}

/** Error for a response body that is not valid JSON or does not match the expected shape. */
export function invalidResponse(message: string, status?: number): SourceError {
  return new SourceError("INVALID_RESPONSE", message, { status });
}

/**
 * Converts anything thrown by `fetch` or a body read into a `SourceError`.
 * The caller's signal wins over the timeout so user cancellation is reported
 * as such. Causes are rebuilt from the message only (redacted), so no request
 * object or header ever travels with the error.
 */
export function mapTransportError(
  error: unknown,
  context: {
    callerSignal?: AbortSignal;
    timeoutSignal: AbortSignal;
    timeoutMs: number;
    secret?: string;
  },
): SourceError {
  // An ABORTED error raised by our own abort checks may really be the timeout firing.
  if (isSourceError(error) && error.code !== "ABORTED") return error;
  if (context.callerSignal?.aborted) {
    return new SourceError("ABORTED", "The request was cancelled.");
  }
  if (context.timeoutSignal.aborted) {
    const seconds = Math.round(context.timeoutMs / 100) / 10;
    return new SourceError("TIMEOUT", `GitHub did not respond within ${seconds}s.`);
  }
  if (isSourceError(error)) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new SourceError("ABORTED", "The request was cancelled.");
  }
  const detail =
    error instanceof Error ? redactSecret(error.message, context.secret) : "unknown error";
  return new SourceError("NETWORK_ERROR", "Could not reach GitHub.", {
    cause: new Error(cleanSingleLine(detail, 200)),
  });
}

/** Error thrown when a caller's signal is already aborted. */
export function abortedError(): SourceError {
  return new SourceError("ABORTED", "The request was cancelled.");
}
