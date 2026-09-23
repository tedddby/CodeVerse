import type { z } from "zod";
import { GitHubApiError } from "./errors";
import { parseJsonBody, validateWith } from "./json";
import { graphqlEnvelopeSchema } from "./schemas";
import { cleanSingleLine, redactSecret } from "./text";

/** GraphQL error entry as returned by GitHub (validated, unknown keys stripped). */
export interface GraphqlErrorEntry {
  type?: string | null;
  message?: string | null;
}

/** Maps the `errors` array of a GraphQL response without `data` to a SourceError. */
export function mapGraphqlErrors(
  errors: readonly GraphqlErrorEntry[],
  secret?: string,
): GitHubApiError {
  const first = errors[0];
  const upstreamMessage =
    typeof first?.message === "string"
      ? cleanSingleLine(redactSecret(first.message, secret), 300) || undefined
      : undefined;
  const options = { status: 200, upstreamMessage };
  switch (first?.type) {
    case "NOT_FOUND":
      return new GitHubApiError(
        "NOT_FOUND",
        "GitHub could not find the requested object.",
        options,
      );
    case "FORBIDDEN":
      return new GitHubApiError(
        "PRIVATE_OR_INACCESSIBLE",
        "GitHub denied access to this resource.",
        options,
      );
    case "UNAUTHORIZED":
      return new GitHubApiError(
        "UNAUTHORIZED",
        "GitHub rejected the configured access token.",
        options,
      );
    default:
      return new GitHubApiError(
        "UPSTREAM_ERROR",
        "GitHub could not execute the GraphQL query.",
        options,
      );
  }
}

/**
 * Only read-only operations are ever sent. A document must start with a
 * `query` operation (or the anonymous `{ ... }` shorthand). Violations are
 * programming errors, hence a `TypeError` rather than a `SourceError`.
 */
export function assertReadOnlyQuery(query: string): void {
  if (!/^\s*(?:query\b|\{)/.test(query) || /\b(?:mutation|subscription)\b/.test(query)) {
    throw new TypeError("Only read-only GraphQL queries are allowed.");
  }
}

export interface GraphqlBodyContext {
  /** Secret to scrub from upstream messages. */
  secret?: string;
  /** When the GraphQL quota resets (from response headers), used as retryAt. */
  fallbackRetryAt: string;
}

/**
 * Interprets a successful (HTTP 2xx) GraphQL answer: rate-limit errors win,
 * an answer without `data` is mapped from its first error, and `data` is
 * validated against `schema`. Partial data (data + errors) is accepted.
 */
export function interpretGraphqlBody<T>(
  bodyText: string,
  schema: z.ZodType<T>,
  context: GraphqlBodyContext,
): T {
  const envelope = parseJsonBody(bodyText, graphqlEnvelopeSchema);
  const errors = envelope.errors ?? [];
  if (errors.some((error) => error.type === "RATE_LIMITED")) {
    throw new GitHubApiError("RATE_LIMITED", "The GitHub GraphQL rate limit is exhausted.", {
      status: 200,
      retryAt: context.fallbackRetryAt,
    });
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw mapGraphqlErrors(errors, context.secret);
  }
  return validateWith(schema, envelope.data, 200);
}
