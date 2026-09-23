import type { z } from "zod";
import type { RateLimitSnapshot } from "@/graph/model/types";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { SourceError, type ReadFileOptions, type SourceFileResult } from "@/sources/types";
import { sleep as defaultSleep, throwIfAborted, type SleepFn } from "./async";
import { decodeUtf8, discardBody, readBoundedBody } from "./content";
import { GitHubApiError, invalidResponse, mapResponseError, mapTransportError } from "./errors";
import { assertReadOnlyQuery, interpretGraphqlBody } from "./graphql";
import {
  isUsableEtag,
  parseBaseUrl,
  resolveApiUrl,
  sendRequest,
  type BaseUrl,
  type SendInit,
} from "./http";
import { parseJsonBody } from "./json";
import { LruCache } from "./lru-cache";
import { encodeRepositoryPath, sanitizeRepositoryPath } from "./paths";
import { RateLimitTracker, parseRateLimitHeaders } from "./rate-limit";
import { interpretRawResponse } from "./raw-download";
import { retryDelay } from "./retry";
import { assertCommitSha, assertOwner, assertRepoName } from "./validation";

export interface GitHubClientOptions {
  /** Personal access / app token. Sent only to the API and GraphQL hosts. */
  token?: string;
  /** Defaults to the global `fetch`, resolved at call time. */
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout (connect + body), default 20 s. */
  requestTimeoutMs?: number;
  userAgent?: string;
  /** Retries for 5xx / network failures, default 2. */
  maxRetries?: number;
  apiBaseUrl?: string;
  rawBaseUrl?: string;
  graphqlUrl?: string;
  /** Longest repository path accepted, default `DEFAULT_LIMITS.maxPathLength`. */
  maxPathLength?: number;
  /** Backoff sleep; injectable so tests do not wait. */
  sleep?: SleepFn;
  /** Clock used for retry-after / rate-limit computations. */
  now?: () => number;
  /** Random source for backoff jitter (0 <= x < 1). */
  random?: () => number;
  /** Maximum number of cached ETag responses, default 300. */
  etagCacheSize?: number;
  /** Hard ceiling on bytes read for any raw file, default `DEFAULT_LIMITS.absoluteMaxFileBytes`. */
  absoluteMaxFileBytes?: number;
}

export interface GetJsonOptions {
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined>;
  /** Send If-None-Match from the ETag cache and reuse the cached body on 304. */
  useEtag?: boolean;
}

export interface GetTextOptions {
  signal?: AbortSignal;
  /** Accept header, e.g. "application/vnd.github.sha". */
  accept?: string;
  useEtag?: boolean;
}

const API_ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";
const DEFAULT_USER_AGENT = "CodeVerse/0.1";
/** Upper bound for API response bodies (a recursive tree of ~200k entries is ~40 MB). */
const MAX_API_BODY_BYTES = 96 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_ETAG_BODY_CHARS = 2_000_000;
const MAX_ETAG_TOTAL_CHARS = 32_000_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const ACCEPT_HEADER = /^[\x20-\x7e]{1,200}$/;

interface CachedBody {
  etag: string;
  bodyText: string;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/**
 * HTTP client for the GitHub REST, GraphQL and raw-content endpoints.
 *
 * Responsibilities: authentication (the token is held in a private field and
 * only ever sent to the API hosts), timeouts combined with caller
 * cancellation, retries with backoff, error mapping to `SourceError`,
 * rate-limit tracking, ETag conditional requests and Zod validation of every
 * JSON payload. One instance is meant to be shared process-wide (see
 * `getSharedGitHubClient`).
 */
export class GitHubClient {
  readonly #token: string | undefined;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #maxRetries: number;
  readonly #api: BaseUrl;
  readonly #raw: BaseUrl;
  readonly #graphqlUrl: URL;
  readonly #maxPathLength: number;
  readonly #absoluteMaxFileBytes: number;
  readonly #sleep: SleepFn;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #etags: LruCache<string, CachedBody>;
  readonly #rateLimits = new RateLimitTracker();

  constructor(options: GitHubClientOptions = {}) {
    const token = options.token?.trim();
    this.#token = token ? token : undefined;
    this.#fetchImpl = options.fetchImpl;
    this.#timeoutMs = Math.max(
      1,
      nonNegativeInteger(options.requestTimeoutMs, DEFAULT_LIMITS.requestTimeoutMs),
    );
    this.#userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.#maxRetries = nonNegativeInteger(options.maxRetries, 2);
    this.#api = parseBaseUrl(options.apiBaseUrl ?? "https://api.github.com", "apiBaseUrl");
    this.#raw = parseBaseUrl(
      options.rawBaseUrl ?? "https://raw.githubusercontent.com",
      "rawBaseUrl",
    );
    const graphql = parseBaseUrl(
      options.graphqlUrl ?? "https://api.github.com/graphql",
      "graphqlUrl",
    );
    this.#graphqlUrl = new URL(`${graphql.origin}${graphql.pathPrefix}`);
    this.#maxPathLength = nonNegativeInteger(options.maxPathLength, DEFAULT_LIMITS.maxPathLength);
    this.#absoluteMaxFileBytes = nonNegativeInteger(
      options.absoluteMaxFileBytes,
      DEFAULT_LIMITS.absoluteMaxFileBytes,
    );
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#etags = new LruCache<string, CachedBody>({
      maxEntries: nonNegativeInteger(options.etagCacheSize, 300),
      maxWeight: MAX_ETAG_TOTAL_CHARS,
      weigh: (entry) => entry.bodyText.length + entry.etag.length,
    });
  }

  hasToken(): boolean {
    return this.#token !== undefined;
  }

  /** Longest repository path this client accepts. */
  get maxPathLength(): number {
    return this.#maxPathLength;
  }

  /** Latest REST "core" quota seen in response headers. */
  getRateLimit(): RateLimitSnapshot | undefined {
    return this.#rateLimits.snapshot("core", this.hasToken());
  }

  /** Latest quota for any resource ("core", "graphql", ...). */
  getRateLimitFor(resource: string): RateLimitSnapshot | undefined {
    return this.#rateLimits.snapshot(resource, this.hasToken());
  }

  /**
   * Whether more than `minRemaining` REST requests are believed to be left.
   * Unknown quota, or a window that has already reset, counts as available.
   */
  hasCoreQuota(minRemaining: number): boolean {
    const reading = this.#rateLimits.get("core");
    if (!reading) return true;
    return reading.remaining > minRemaining || Date.parse(reading.resetAt) <= this.#now();
  }

  /** GET a REST endpoint and validate the JSON body. A 204 answer is validated as `null`. */
  async getJson<T>(path: string, schema: z.ZodType<T>, options: GetJsonOptions = {}): Promise<T> {
    const url = resolveApiUrl(this.#api, path, options.query);
    const useEtag = options.useEtag ?? false;
    const bodyText = await this.#getApiBody(url, API_ACCEPT, useEtag, options.signal);
    return parseJsonBody(bodyText, schema);
  }

  /** GET a REST endpoint and return the body as text (e.g. with `application/vnd.github.sha`). */
  async getText(path: string, options: GetTextOptions = {}): Promise<string> {
    const accept = options.accept ?? API_ACCEPT;
    if (!ACCEPT_HEADER.test(accept)) throw new TypeError("Invalid Accept header.");
    const url = resolveApiUrl(this.#api, path);
    return (await this.#getApiBody(url, accept, options.useEtag ?? false, options.signal)) ?? "";
  }

  /**
   * Runs a read-only GraphQL query. Values must be passed as `variables`, never
   * interpolated into `query`. Requires a token (GitHub's GraphQL API has no
   * anonymous access).
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.#token) {
      throw new SourceError("UNAUTHORIZED", "GitHub's GraphQL API requires an access token.");
    }
    assertReadOnlyQuery(query);
    const init: SendInit = {
      method: "POST",
      headers: { ...this.#apiHeaders("application/json"), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    };
    // Queries are read-only, so retrying transient failures is safe.
    const bodyText = await this.#withRetries(signal, async (attemptSignal) => {
      const response = await sendRequest(this.#fetch(), this.#graphqlUrl, init, attemptSignal);
      this.#recordRateLimit(response.headers, "graphql");
      if (!response.ok) throw await this.#responseError(response);
      return this.#readApiText(response, attemptSignal);
    });
    return interpretGraphqlBody(bodyText, schema, {
      secret: this.#token,
      fallbackRetryAt:
        this.#rateLimits.get("graphql")?.resetAt ??
        new Date(this.#now() + DEFAULT_RATE_LIMIT_WAIT_MS).toISOString(),
    });
  }

  /**
   * Downloads a file from the raw-content host at an exact commit. Never sends
   * credentials. Never throws for missing, binary or oversized files; throws
   * `SourceError` for throttling (RATE_LIMITED), server failures
   * (UPSTREAM_ERROR, after retries) and malformed input (INVALID_REPOSITORY).
   */
  async getRawFile(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    options: ReadFileOptions,
  ): Promise<SourceFileResult> {
    const commit = assertCommitSha(sha);
    const safePath = sanitizeRepositoryPath(path, this.#maxPathLength);
    if (safePath === null) {
      throw new SourceError("INVALID_REPOSITORY", "The file path is not valid.");
    }
    const url = new URL(
      `${this.#raw.origin}${this.#raw.pathPrefix}/${encodeURIComponent(assertOwner(owner))}/` +
        `${encodeURIComponent(assertRepoName(repo))}/${commit}/${encodeRepositoryPath(safePath)}`,
    );
    const maxBytes = this.#clampMaxBytes(options.maxBytes);
    // Deliberately built without #apiHeaders: no Authorization for the raw host.
    const init: SendInit = {
      method: "GET",
      headers: { Accept: "*/*", "User-Agent": this.#userAgent },
    };
    return this.#withRetries(options.signal, async (attemptSignal) => {
      const response = await sendRequest(this.#fetch(), url, init, attemptSignal);
      return interpretRawResponse(response, { maxBytes, signal: attemptSignal, now: this.#now() });
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  #fetch(): typeof fetch {
    return this.#fetchImpl ?? globalThis.fetch;
  }

  #apiHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": this.#userAgent,
    };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    return headers;
  }

  async #getApiBody(
    url: URL,
    accept: string,
    useEtag: boolean,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const cacheKey = `${accept} ${url.href}`;
    return this.#withRetries(signal, async (attemptSignal) => {
      const cached = useEtag ? this.#etags.get(cacheKey) : undefined;
      const headers = this.#apiHeaders(accept);
      if (cached) headers["If-None-Match"] = cached.etag;
      const response = await sendRequest(
        this.#fetch(),
        url,
        { method: "GET", headers },
        attemptSignal,
      );
      this.#recordRateLimit(response.headers, "core");
      if (response.status === 304) {
        await discardBody(response);
        if (!cached) throw invalidResponse("GitHub answered 304 to an unconditional request.", 304);
        return cached.bodyText;
      }
      if (response.status === 204) {
        await discardBody(response);
        return null;
      }
      if (!response.ok) throw await this.#responseError(response);
      const bodyText = await this.#readApiText(response, attemptSignal);
      const etag = response.headers.get("etag");
      if (useEtag && isUsableEtag(etag) && bodyText.length <= MAX_ETAG_BODY_CHARS) {
        this.#etags.set(cacheKey, { etag, bodyText });
      }
      return bodyText;
    });
  }

  async #readApiText(response: Response, signal: AbortSignal): Promise<string> {
    const read = await readBoundedBody(response, MAX_API_BODY_BYTES, signal);
    if (read.kind === "overflow") {
      throw new GitHubApiError(
        "UPSTREAM_ERROR",
        "GitHub returned an unexpectedly large response.",
        {
          status: response.status,
        },
      );
    }
    return decodeUtf8(read.bytes);
  }

  async #responseError(response: Response): Promise<GitHubApiError> {
    let bodyText = "";
    try {
      const read = await readBoundedBody(response, MAX_ERROR_BODY_BYTES);
      if (read.kind === "complete") bodyText = decodeUtf8(read.bytes);
    } catch {
      // The status code alone is enough to classify the failure.
    }
    return mapResponseError({
      status: response.status,
      headers: response.headers,
      bodyText,
      now: this.#now(),
      secret: this.#token,
    });
  }

  #recordRateLimit(headers: Headers, defaultResource: string): void {
    const reading = parseRateLimitHeaders(headers);
    if (!reading) return;
    const resource = headers.has("x-ratelimit-resource") ? reading.resource : defaultResource;
    this.#rateLimits.record({ ...reading, resource });
  }

  #clampMaxBytes(maxBytes: number): number {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) return this.#absoluteMaxFileBytes;
    return Math.min(Math.floor(maxBytes), this.#absoluteMaxFileBytes);
  }

  /**
   * Runs `operation` with a per-attempt timeout combined with the caller's
   * signal, retrying transient failures according to `retryDelay`.
   */
  async #withRetries<T>(
    signal: AbortSignal | undefined,
    operation: (attemptSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    for (let attempt = 0; ; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let failure: SourceError;
      try {
        return await operation(attemptSignal);
      } catch (error) {
        failure = mapTransportError(error, {
          callerSignal: signal,
          timeoutSignal,
          timeoutMs: this.#timeoutMs,
          secret: this.#token,
        });
      }
      const delay = retryDelay(failure, attempt, {
        maxRetries: this.#maxRetries,
        random: this.#random,
      });
      if (delay === undefined) throw failure;
      await this.#sleep(delay, signal);
    }
  }
}
