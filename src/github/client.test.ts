import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SourceError } from "@/sources/types";
import {
  createFakeFetch,
  emptyResponse,
  hangUntilAborted,
  jsonResponse,
  rateLimitHeaders,
  recordingSleep,
  textResponse,
  type FakeHandler,
} from "./__fixtures__/fake-fetch";
import { GitHubClient, type GitHubClientOptions } from "./client";

const TOKEN = "ghp_TESTTOKEN_0123456789abcdefABCDEF";
const NOW = Date.parse("2026-09-23T12:00:00Z");
const okSchema = z.object({ ok: z.boolean() });

function setup(handler: FakeHandler, options: GitHubClientOptions = {}) {
  const fake = createFakeFetch(handler);
  const { sleep, delays } = recordingSleep();
  const client = new GitHubClient({
    fetchImpl: fake.fetch,
    sleep,
    random: () => 0.5,
    now: () => NOW,
    ...options,
  });
  return { client, requests: fake.requests, delays };
}

async function captureError(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SourceError) return error;
    throw error;
  }
  throw new Error("Expected the promise to reject");
}

describe("GitHubClient REST requests", () => {
  it("sends the GitHub API headers and a bearer token to the API host", async () => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }), { token: `  ${TOKEN}  ` });
    await expect(client.getJson("/repos/facebook/react", okSchema)).resolves.toEqual({ ok: true });
    const [request] = requests;
    expect(request?.url.href).toBe("https://api.github.com/repos/facebook/react");
    expect(request?.headers).toMatchObject({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "CodeVerse/0.1",
      authorization: `Bearer ${TOKEN}`,
    });
    expect(client.hasToken()).toBe(true);
  });

  it("sends no Authorization header without a token (empty tokens count as none)", async () => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }), { token: "   " });
    await client.getJson("/rate_limit", okSchema);
    expect(requests[0]?.headers.authorization).toBeUndefined();
    expect(client.hasToken()).toBe(false);
  });

  it("encodes query parameters and skips undefined values", async () => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }));
    await client.getJson("/repos/o/r/commits", okSchema, {
      query: { sha: "a b&c", per_page: 100, page: undefined },
    });
    expect(requests[0]?.url.search).toBe("?sha=a+b%26c&per_page=100");
  });

  it.each([
    "/repos/o/../../admin",
    "//evil.example/x",
    "/repos/o/r/%2e%2e/x",
    "https://evil.example/x",
    "/repos/o r",
    "repos/o/r",
    "/repos/o/r?x=1",
  ])("refuses to build a URL from the malformed path %j", async (path) => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }));
    const error = await captureError(client.getJson(path, okSchema));
    expect(error.code).toBe("INVALID_REPOSITORY");
    expect(requests).toHaveLength(0);
  });

  it("returns text bodies with a custom Accept header", async () => {
    const sha = "a".repeat(40);
    const { client, requests } = setup(() => textResponse(`${sha}\n`));
    await expect(
      client.getText("/repos/o/r/commits/main", { accept: "application/vnd.github.sha" }),
    ).resolves.toBe(`${sha}\n`);
    expect(requests[0]?.headers.accept).toBe("application/vnd.github.sha");
  });

  it("validates a 204 answer as null", async () => {
    const { client } = setup(() => emptyResponse(204));
    await expect(client.getJson("/x", z.array(z.number()).nullable())).resolves.toBeNull();
    const error = await captureError(client.getJson("/x", okSchema));
    expect(error.code).toBe("INVALID_RESPONSE");
  });
});

describe("GitHubClient error mapping", () => {
  it.each([
    [404, {}, {}, "NOT_FOUND"],
    [401, {}, { message: "Bad credentials" }, "UNAUTHORIZED"],
    [
      403,
      rateLimitHeaders({ remaining: 0 }),
      { message: "API rate limit exceeded" },
      "RATE_LIMITED",
    ],
    [403, { "retry-after": "60" }, { message: "secondary" }, "RATE_LIMITED"],
    [403, {}, { message: "You have exceeded a secondary rate limit" }, "RATE_LIMITED"],
    [403, {}, { message: "Resource not accessible" }, "PRIVATE_OR_INACCESSIBLE"],
    [429, {}, {}, "RATE_LIMITED"],
    [409, {}, { message: "Git Repository is empty." }, "EMPTY_REPOSITORY"],
    [451, {}, { message: "Repository access blocked" }, "PRIVATE_OR_INACCESSIBLE"],
    [422, {}, { message: "No commit found for SHA: x" }, "NOT_FOUND"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, headers, body, code) => {
    const { client, requests } = setup(() => jsonResponse(body, { status, headers }));
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    // Only a secondary limit with retry-after <= 5 s is retried; none of these qualify.
    expect(requests).toHaveLength(1);
  });

  it("uses x-ratelimit-reset as retryAt for exhausted quotas", async () => {
    const { client } = setup(() =>
      jsonResponse(
        {},
        { status: 403, headers: rateLimitHeaders({ remaining: 0, reset: 1_790_000_000 }) },
      ),
    );
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.retryAt).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it("retries 5xx responses with exponential backoff and then succeeds", async () => {
    let calls = 0;
    const { client, requests, delays } = setup(() => {
      calls += 1;
      return calls < 3
        ? jsonResponse({ message: "oops" }, { status: 502 })
        : jsonResponse({ ok: true });
    });
    await expect(client.getJson("/repos/o/r", okSchema)).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(3);
    expect(delays).toEqual([300, 900]);
  });

  it("gives up after maxRetries with UPSTREAM_ERROR", async () => {
    const { client, requests } = setup(() => jsonResponse({}, { status: 503 }));
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe("UPSTREAM_ERROR");
    expect(error.status).toBe(503);
    expect(requests).toHaveLength(3);
  });

  it("honours maxRetries: 0", async () => {
    const { client, requests } = setup(() => jsonResponse({}, { status: 500 }), { maxRetries: 0 });
    await captureError(client.getJson("/repos/o/r", okSchema));
    expect(requests).toHaveLength(1);
  });

  it("retries network errors and reports NETWORK_ERROR when they persist", async () => {
    const { client, requests } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(requests).toHaveLength(3);
  });

  it("retries a short secondary rate limit after its retry-after delay", async () => {
    let calls = 0;
    const { client, delays } = setup(() => {
      calls += 1;
      return calls === 1
        ? jsonResponse(
            { message: "secondary rate limit" },
            { status: 403, headers: { "retry-after": "2" } },
          )
        : jsonResponse({ ok: true });
    });
    await expect(client.getJson("/repos/o/r", okSchema)).resolves.toEqual({ ok: true });
    expect(delays).toEqual([2_000]);
  });

  it("does not retry a long secondary rate limit", async () => {
    const { client, requests } = setup(() =>
      jsonResponse(
        { message: "secondary rate limit" },
        { status: 429, headers: { "retry-after": "30" } },
      ),
    );
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAt).toBe(new Date(NOW + 30_000).toISOString());
    expect(requests).toHaveLength(1);
  });

  it("maps a per-attempt timeout to TIMEOUT without retrying", async () => {
    const { client, requests } = setup(hangUntilAborted, { requestTimeoutMs: 25 });
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe("TIMEOUT");
    expect(requests).toHaveLength(1);
  });

  it("maps caller cancellation to ABORTED", async () => {
    const { client } = setup(hangUntilAborted);
    const controller = new AbortController();
    const pending = client.getJson("/repos/o/r", okSchema, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const error = await captureError(pending);
    expect(error.code).toBe("ABORTED");
  });

  it("does not send a request for an already aborted signal", async () => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }));
    const error = await captureError(
      client.getJson("/x", okSchema, { signal: AbortSignal.abort() }),
    );
    expect(error.code).toBe("ABORTED");
    expect(requests).toHaveLength(0);
  });

  it("reports malformed JSON and schema mismatches as INVALID_RESPONSE", async () => {
    const malformed = setup(() =>
      textResponse("{not json", { headers: { "content-type": "application/json" } }),
    );
    expect((await captureError(malformed.client.getJson("/x", okSchema))).code).toBe(
      "INVALID_RESPONSE",
    );

    const mismatch = setup(() => jsonResponse({ ok: "yes" }));
    const error = await captureError(mismatch.client.getJson("/x", okSchema));
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.message).toContain('"ok"');
  });
});

describe("GitHubClient rate limits and ETags", () => {
  it("tracks the core quota from response headers", async () => {
    const { client } = setup(() =>
      jsonResponse(
        { ok: true },
        { headers: rateLimitHeaders({ limit: 60, remaining: 42, reset: 1_900_000_000 }) },
      ),
    );
    expect(client.getRateLimit()).toBeUndefined();
    await client.getJson("/x", okSchema);
    expect(client.getRateLimit()).toEqual({
      limit: 60,
      remaining: 42,
      resetAt: new Date(1_900_000_000_000).toISOString(),
      authenticated: false,
    });
    expect(client.hasCoreQuota(50)).toBe(false);
    expect(client.hasCoreQuota(10)).toBe(true);
  });

  it("records quota from error responses too and treats a past reset as available", async () => {
    const { client } = setup(() =>
      jsonResponse(
        {},
        { status: 403, headers: rateLimitHeaders({ remaining: 0, reset: NOW / 1000 - 1 }) },
      ),
    );
    await captureError(client.getJson("/x", okSchema));
    expect(client.getRateLimit()?.remaining).toBe(0);
    expect(client.hasCoreQuota(50)).toBe(true);
  });

  it("sends If-None-Match and reuses the cached body on 304", async () => {
    let calls = 0;
    const { client, requests } = setup((request) => {
      calls += 1;
      if (request.headers["if-none-match"] === '"v1"')
        return emptyResponse(304, rateLimitHeaders({ remaining: 59 }));
      return jsonResponse({ ok: calls === 1 }, { headers: { etag: '"v1"' } });
    });
    await expect(client.getJson("/repos/o/r", okSchema, { useEtag: true })).resolves.toEqual({
      ok: true,
    });
    await expect(client.getJson("/repos/o/r", okSchema, { useEtag: true })).resolves.toEqual({
      ok: true,
    });
    expect(requests[0]?.headers["if-none-match"]).toBeUndefined();
    expect(requests[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(client.getRateLimit()?.remaining).toBe(59);
  });

  it("does not use conditional requests unless asked", async () => {
    const { client, requests } = setup(() =>
      jsonResponse({ ok: true }, { headers: { etag: '"v1"' } }),
    );
    await client.getJson("/repos/o/r", okSchema);
    await client.getJson("/repos/o/r", okSchema);
    expect(requests.every((request) => request.headers["if-none-match"] === undefined)).toBe(true);
  });

  it("rejects a 304 to an unconditional request", async () => {
    const { client } = setup(() => emptyResponse(304));
    expect((await captureError(client.getJson("/x", okSchema, { useEtag: true }))).code).toBe(
      "INVALID_RESPONSE",
    );
  });
});

describe("GitHubClient redirects", () => {
  it("follows same-origin redirects (renamed repositories)", async () => {
    const { client, requests } = setup(
      (request) =>
        request.url.pathname === "/repos/old/name"
          ? emptyResponse(301, { location: "https://api.github.com/repositories/42" })
          : jsonResponse({ ok: true }),
      { token: TOKEN },
    );
    await expect(client.getJson("/repos/old/name", okSchema)).resolves.toEqual({ ok: true });
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/repos/old/name",
      "/repositories/42",
    ]);
    expect(requests[1]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("never follows a redirect to another host", async () => {
    const { client, requests } = setup(
      () => emptyResponse(302, { location: "https://evil.example/steal" }),
      { token: TOKEN },
    );
    const error = await captureError(client.getJson("/repos/o/r", okSchema));
    expect(error.code).toBe("UPSTREAM_ERROR");
    expect(requests.every((request) => request.url.hostname === "api.github.com")).toBe(true);
  });

  it("stops after three redirects", async () => {
    let hop = 0;
    const { client, requests } = setup(
      () => {
        hop += 1;
        return emptyResponse(307, { location: `/loop/${hop}` });
      },
      { maxRetries: 0 },
    );
    expect((await captureError(client.getJson("/start", okSchema))).code).toBe("UPSTREAM_ERROR");
    expect(requests).toHaveLength(4);
  });
});

describe("GitHubClient secrecy", () => {
  it("never exposes the token through errors, causes or serialization", async () => {
    const scenarios: FakeHandler[] = [
      () => jsonResponse({ message: `Bad credentials for ${TOKEN}` }, { status: 401 }),
      () => jsonResponse({ message: `Forbidden ${TOKEN}` }, { status: 403 }),
      () => jsonResponse({ message: `secondary rate limit ${TOKEN}` }, { status: 403 }),
      () => {
        throw new TypeError(`connect failed with header Authorization: Bearer ${TOKEN}`);
      },
      () => jsonResponse({ unexpected: TOKEN }),
      () => textResponse(`not json ${TOKEN}`),
    ];
    for (const handler of scenarios) {
      const { client } = setup(handler, { token: TOKEN, maxRetries: 1 });
      const error = await captureError(client.getJson("/repos/o/r", okSchema));
      const cause =
        error.cause instanceof Error
          ? `${error.cause.name} ${error.cause.message}`
          : String(error.cause);
      for (const rendered of [
        error.message,
        cause,
        JSON.stringify(error),
        inspect(error, { showHidden: true, depth: 10 }),
        String(error),
      ]) {
        expect(rendered).not.toContain(TOKEN);
      }
    }
  });

  it("does not reveal the token when the client itself is serialized or inspected", () => {
    const client = new GitHubClient({ token: TOKEN });
    expect(JSON.stringify(client)).not.toContain(TOKEN);
    expect(inspect(client, { showHidden: true, depth: 10 })).not.toContain(TOKEN);
  });
});

describe("GitHubClient GraphQL", () => {
  const dataSchema = z.object({ viewer: z.object({ login: z.string() }) });

  it("requires a token and sends nothing without one", async () => {
    const { client, requests } = setup(() => jsonResponse({}));
    const error = await captureError(client.graphql("query { viewer { login } }", {}, dataSchema));
    expect(error.code).toBe("UNAUTHORIZED");
    expect(requests).toHaveLength(0);
  });

  it("POSTs the query and variables to the GraphQL endpoint with the token", async () => {
    const { client, requests } = setup(
      () =>
        jsonResponse(
          { data: { viewer: { login: "octocat" } } },
          { headers: rateLimitHeaders({ remaining: 4999, resource: "graphql" }) },
        ),
      { token: TOKEN },
    );
    await expect(
      client.graphql("query Q($a:String!){ viewer { login } }", { a: "x" }, dataSchema),
    ).resolves.toEqual({ viewer: { login: "octocat" } });
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url.href).toBe("https://api.github.com/graphql");
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      query: "query Q($a:String!){ viewer { login } }",
      variables: { a: "x" },
    });
    expect(client.getRateLimitFor("graphql")?.remaining).toBe(4999);
    expect(client.getRateLimit()).toBeUndefined();
  });

  it("maps GraphQL-level errors", async () => {
    const rateLimited = setup(
      () =>
        jsonResponse({
          data: null,
          errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
        }),
      { token: TOKEN },
    );
    expect((await captureError(rateLimited.client.graphql("query{a}", {}, dataSchema))).code).toBe(
      "RATE_LIMITED",
    );

    const notFound = setup(
      () =>
        jsonResponse({ data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] }),
      { token: TOKEN },
    );
    expect((await captureError(notFound.client.graphql("query{a}", {}, dataSchema))).code).toBe(
      "NOT_FOUND",
    );

    const shape = setup(() => jsonResponse({ data: { viewer: null } }), { token: TOKEN });
    expect((await captureError(shape.client.graphql("query{a}", {}, dataSchema))).code).toBe(
      "INVALID_RESPONSE",
    );
  });

  it("retries transient 5xx answers", async () => {
    let calls = 0;
    const { client } = setup(
      () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, { status: 502 })
          : jsonResponse({ data: { viewer: { login: "x" } } });
      },
      { token: TOKEN },
    );
    await expect(client.graphql("query{viewer{login}}", {}, dataSchema)).resolves.toEqual({
      viewer: { login: "x" },
    });
    expect(calls).toBe(2);
  });

  it("refuses mutations", async () => {
    const { client, requests } = setup(() => jsonResponse({}), { token: TOKEN });
    await expect(client.graphql("mutation { x }", {}, dataSchema)).rejects.toThrow(TypeError);
    await expect(client.graphql("query { a } mutation { b }", {}, dataSchema)).rejects.toThrow(
      TypeError,
    );
    expect(requests).toHaveLength(0);
  });
});

describe("GitHubClient configuration", () => {
  it("accepts GitHub Enterprise-style API prefixes", async () => {
    const { client, requests } = setup(() => jsonResponse({ ok: true }), {
      apiBaseUrl: "https://ghe.example.com/api/v3/",
    });
    await client.getJson("/repos/o/r", okSchema);
    expect(requests[0]?.url.href).toBe("https://ghe.example.com/api/v3/repos/o/r");
  });

  it("rejects insecure or credential-bearing base URLs", () => {
    expect(() => new GitHubClient({ apiBaseUrl: "http://api.example.com" })).toThrow(TypeError);
    expect(() => new GitHubClient({ rawBaseUrl: "https://user:pw@raw.example.com" })).toThrow(
      TypeError,
    );
    expect(() => new GitHubClient({ graphqlUrl: "not a url" })).toThrow(TypeError);
    expect(() => new GitHubClient({ apiBaseUrl: "http://127.0.0.1:8080" })).not.toThrow();
  });
});
