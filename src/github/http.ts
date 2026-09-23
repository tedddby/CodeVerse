import { GitHubApiError } from "./errors";
import { discardBody } from "./content";

/**
 * Low-level HTTP plumbing for the GitHub client: configured base URLs, API path
 * validation and same-origin redirect handling. Requests are only ever built
 * from a configured base URL plus a validated path, never from user-supplied
 * hosts.
 */

export interface BaseUrl {
  origin: string;
  /** Path prefix without trailing slash ("" for https://api.github.com, "/api/v3" for GHES). */
  pathPrefix: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Parses a configured base URL. Plain http is only accepted for loopback hosts (local mocks). */
export function parseBaseUrl(value: string, label: string): BaseUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} is not a valid URL.`);
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) throw new TypeError(`${label} must use https.`);
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must not contain credentials, a query or a fragment.`);
  }
  return { origin: url.origin, pathPrefix: url.pathname.replace(/\/+$/, "") };
}

/** Characters allowed in an already-encoded API path segment (RFC 3986 pchar). */
const API_PATH = /^(?:\/[A-Za-z0-9\-._~%!$&'()*+,;=:@]+)+$/;
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Resolves an API path ("/repos/o/r/...") against a base URL. The path must be
 * absolute, already percent-encoded and free of dot segments; the resulting URL
 * is verified to stay under the base URL.
 */
export function resolveApiUrl(
  base: BaseUrl,
  path: string,
  query?: Record<string, string | number | undefined>,
): URL {
  const segments = path.split("/").slice(1);
  if (!API_PATH.test(path) || segments.some((segment) => DOT_SEGMENT.test(segment))) {
    throw new GitHubApiError("INVALID_REPOSITORY", "Refusing to build a malformed GitHub API URL.");
  }
  const url = new URL(`${base.origin}${base.pathPrefix}${path}`);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathPrefix}/`)) {
    throw new GitHubApiError("INVALID_REPOSITORY", "Refusing to build a malformed GitHub API URL.");
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export interface SendInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

function unexpectedRedirect(status: number): GitHubApiError {
  return new GitHubApiError("UPSTREAM_ERROR", "GitHub answered with an unexpected redirect.", {
    status,
  });
}

/**
 * Performs a request with `redirect: "manual"` and follows at most three
 * redirects, and only within the same origin (GitHub uses them for renamed
 * repositories). Headers — including Authorization, when present — are
 * therefore never forwarded to another host.
 */
export async function sendRequest(
  fetchImpl: typeof fetch,
  url: URL,
  init: SendInit,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const response = await fetchImpl(current.href, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    await discardBody(response);
    const location = response.headers.get("location");
    if (init.method !== "GET" || !location || hop >= MAX_REDIRECTS) {
      throw unexpectedRedirect(response.status);
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw unexpectedRedirect(response.status);
    }
    if (next.origin !== current.origin || next.username || next.password) {
      throw unexpectedRedirect(response.status);
    }
    current = next;
  }
}

/** Parses a Content-Length header; undefined when absent or malformed. */
export function parseContentLength(headers: Headers): number | undefined {
  const raw = headers.get("content-length")?.trim();
  if (!raw || !/^\d{1,15}$/.test(raw)) return undefined;
  return Number(raw);
}

/** ETags are echoed back in If-None-Match, so only printable ASCII of sane length is kept. */
export function isUsableEtag(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
}
