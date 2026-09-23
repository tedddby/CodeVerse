import type { SourceFileResult } from "@/sources/types";
import { classifyContent, discardBody, readBoundedBody } from "./content";
import { GitHubApiError, mapResponseError } from "./errors";
import { parseContentLength } from "./http";
import { parseRetryAfterMs } from "./rate-limit";

/**
 * Interpretation of one raw-content download attempt. The contract of
 * `RepositorySource.readFile` applies: missing, binary and oversized files are
 * results, not errors; throttling and server failures are errors.
 */

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export interface RawDownloadContext {
  /** Byte budget; anything larger is reported as `too-large`. */
  maxBytes: number;
  signal: AbortSignal;
  now: number;
}

export async function interpretRawResponse(
  response: Response,
  context: RawDownloadContext,
): Promise<SourceFileResult> {
  if (response.status === 404) {
    await discardBody(response);
    return { kind: "missing" };
  }
  if (response.status === 403 || response.status === 429) {
    await discardBody(response);
    const retryAfterMs = parseRetryAfterMs(response.headers, context.now);
    throw new GitHubApiError("RATE_LIMITED", "GitHub is throttling file downloads.", {
      status: response.status,
      retryAt: new Date(context.now + (retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS)).toISOString(),
      retryAfterMs,
    });
  }
  if (!response.ok) {
    await discardBody(response);
    throw mapResponseError({
      status: response.status,
      headers: response.headers,
      bodyText: "",
      now: context.now,
    });
  }
  // Content-Length may describe a compressed body; it is still a lower bound
  // of the decoded size, so exceeding the budget here is conclusive.
  const declared = parseContentLength(response.headers);
  if (declared !== undefined && declared > context.maxBytes) {
    await discardBody(response);
    return { kind: "too-large", size: declared };
  }
  const read = await readBoundedBody(response, context.maxBytes, context.signal);
  if (read.kind === "overflow") {
    return { kind: "too-large", size: Math.max(read.bytesRead, declared ?? 0) };
  }
  return classifyContent(read.bytes);
}
