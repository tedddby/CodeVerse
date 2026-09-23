/**
 * Test doubles for `fetch`. No network access: every request is recorded and
 * answered by a handler, so tests can assert on URLs, headers and bodies.
 */

export interface RecordedRequest {
  url: URL;
  method: string;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FakeHandler = (request: RecordedRequest) => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

export function createFakeFetch(handler: FakeHandler): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request: RecordedRequest = {
      url: new URL(href),
      method: init?.method ?? "GET",
      headers: normalizeHeaders(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal ?? undefined,
    };
    requests.push(request);
    if (request.signal?.aborted) throw request.signal.reason;
    return handler(request);
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

export interface ResponseInitLite {
  status?: number;
  headers?: Record<string, string>;
}

export function jsonResponse(body: unknown, init: ResponseInitLite = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });
}

export function textResponse(text: string, init: ResponseInitLite = {}): Response {
  return new Response(text, { status: init.status ?? 200, headers: init.headers });
}

export function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

export function rateLimitHeaders(options: {
  limit?: number;
  remaining: number;
  reset?: number;
  resource?: string;
}): Record<string, string> {
  return {
    "x-ratelimit-limit": String(options.limit ?? 5000),
    "x-ratelimit-remaining": String(options.remaining),
    "x-ratelimit-reset": String(options.reset ?? 1_900_000_000),
    "x-ratelimit-resource": options.resource ?? "core",
  };
}

/** A streaming response built from chunks; `state.cancelled` records early cancellation. */
export function streamResponse(
  chunks: readonly Uint8Array[],
  init: ResponseInitLite = {},
): { response: Response; state: { cancelled: boolean; pulled: number } } {
  const state = { cancelled: false, pulled: 0 };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      state.pulled += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    response: new Response(stream, { status: init.status ?? 200, headers: init.headers }),
    state,
  };
}

/** Never answers; rejects with the signal's reason once the request is aborted. */
export function hangUntilAborted(request: RecordedRequest): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = request.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Instant, recorded sleep for retry tests. */
export function recordingSleep(): {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms);
    },
  };
}
