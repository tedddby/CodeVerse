import type {
  SourceErrorCode,
  SourceErrorResponse,
  SourceFileResponse,
} from "@/analysis/source-protocol";

/** Minimal least-recently-used cache backed by Map insertion order. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.entries.size;
  }

  /** Returns the value and marks it as most recently used. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Returns the value without touching recency (safe to call during render). */
  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export type SourceViewerErrorCode = SourceErrorCode | "NETWORK" | "INVALID_RESPONSE";

export interface SourceViewerError {
  code: SourceViewerErrorCode;
  title: string;
  message: string;
  /** Whether trying again could help (network hiccups, rate limits, upstream errors). */
  retryable: boolean;
}

export type SourceLoadResult =
  { ok: true; file: SourceFileResponse } | { ok: false; error: SourceViewerError };

/** Recently viewed files, keyed by source API URL (which includes the commit SHA). */
export const sourceFileCache = new LruCache<string, SourceFileResponse>(20);

const RETRYABLE: ReadonlySet<SourceViewerErrorCode> = new Set([
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL",
  "NETWORK",
]);

const FALLBACK_COPY: Record<SourceViewerErrorCode, { title: string; message: string }> = {
  INVALID_REQUEST: {
    title: "This file can't be requested.",
    message: "The file path or commit is not valid.",
  },
  NOT_FOUND: {
    title: "File not found.",
    message: "The file does not exist at the analysed commit.",
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
    message: "Please try again in a moment.",
  },
  INTERNAL: { title: "Something went wrong loading this file.", message: "Please try again." },
  NETWORK: { title: "Couldn't reach the server.", message: "Check your connection and try again." },
  INVALID_RESPONSE: {
    title: "Unexpected response.",
    message: "The server returned data the viewer can't read.",
  },
};

const ERROR_CODES: ReadonlySet<string> = new Set<SourceErrorCode>([
  "INVALID_REQUEST",
  "NOT_FOUND",
  "BINARY",
  "TOO_LARGE",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSourceFileResponse(value: unknown): value is SourceFileResponse {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.ref === "string" &&
    typeof value.content === "string" &&
    typeof value.language === "string" &&
    typeof value.size === "number" &&
    typeof value.lines === "number"
  );
}

export function isSourceErrorResponse(value: unknown): value is SourceErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  const { code, title, message } = value.error;
  return (
    typeof code === "string" &&
    ERROR_CODES.has(code) &&
    typeof title === "string" &&
    typeof message === "string"
  );
}

export function viewerError(
  code: SourceViewerErrorCode,
  override?: { title?: string; message?: string },
): SourceViewerError {
  const copy = FALLBACK_COPY[code];
  return {
    code,
    title: override?.title?.trim() || copy.title,
    message: override?.message?.trim() || copy.message,
    retryable: RETRYABLE.has(code),
  };
}

function statusToCode(status: number): SourceViewerErrorCode {
  if (status === 404) return "NOT_FOUND";
  if (status === 413) return "TOO_LARGE";
  if (status === 415) return "BINARY";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400) return "INVALID_REQUEST";
  if (status >= 500) return "UPSTREAM_ERROR";
  return "INVALID_RESPONSE";
}

export class SourceRequestAbortedError extends Error {
  constructor() {
    super("Source request aborted");
    this.name = "SourceRequestAbortedError";
  }
}

/**
 * Fetches a file through the source API. Successful responses are cached (LRU);
 * failures are returned as user-facing errors, never thrown. Aborting the signal
 * rejects with `SourceRequestAbortedError`.
 */
export async function fetchSourceFile(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SourceLoadResult> {
  const cached = sourceFileCache.get(url);
  if (cached) return { ok: true, file: cached };

  let response: Response;
  try {
    response = await fetcher(url, { signal, headers: { Accept: "application/json" } });
  } catch {
    if (signal.aborted) throw new SourceRequestAbortedError();
    return { ok: false, error: viewerError("NETWORK") };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw new SourceRequestAbortedError();
    body = null;
  }
  if (signal.aborted) throw new SourceRequestAbortedError();

  if (response.ok && isSourceFileResponse(body)) {
    sourceFileCache.set(url, body);
    return { ok: true, file: body };
  }
  if (isSourceErrorResponse(body)) {
    return {
      ok: false,
      error: viewerError(body.error.code, { title: body.error.title, message: body.error.message }),
    };
  }
  return {
    ok: false,
    error: viewerError(response.ok ? "INVALID_RESPONSE" : statusToCode(response.status)),
  };
}
