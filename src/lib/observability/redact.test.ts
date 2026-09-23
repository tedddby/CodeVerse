import { afterEach, describe, expect, it } from "vitest";
import { SourceError } from "@/sources/types";
import {
  REDACTED,
  clearRegisteredSecrets,
  isSensitiveKey,
  redactSecrets,
  redactString,
  registerSecret,
} from "./redact";

const CLASSIC = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FINE_GRAINED =
  "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ";

afterEach(() => {
  clearRegisteredSecrets();
});

describe("redactString", () => {
  it.each([
    [`token ${CLASSIC} leaked`, `token ${REDACTED} leaked`],
    [
      `gho_abc123 ghu_def456 ghs_ghi789 ghr_jkl012`,
      `${REDACTED} ${REDACTED} ${REDACTED} ${REDACTED}`,
    ],
    [`pat=${FINE_GRAINED}`, `pat=${REDACTED}`],
    ["Authorization: Bearer eyJhbGciOi.payload.sig", `Authorization: Bearer ${REDACTED}`],
    ["Basic dXNlcjpwYXNz", `Basic ${REDACTED}`],
    [
      "GET https://api.example.com/x?access_token=abc123&page=2",
      `GET https://api.example.com/x?access_token=${REDACTED}&page=2`,
    ],
    ["?token=secret#frag", `?token=${REDACTED}#frag`],
    ["https://user:hunter2@example.com/repo.git", `https://${REDACTED}@example.com/repo.git`],
  ])("masks %j", (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it("leaves ordinary text alone", () => {
    const text = "The token was rejected; retry with tokens=5 and max_token=3.";
    expect(redactString(text)).toBe(text);
  });

  it("masks registered secrets whatever their format", () => {
    const legacy = "0123456789abcdef0123456789abcdef01234567";
    registerSecret(legacy);
    registerSecret("short");
    expect(redactString(`auth ${legacy}!`)).toBe(`auth ${REDACTED}!`);
    expect(redactString("a short word")).toBe("a short word");
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "authorization",
    "Cookie",
    "set-cookie",
    "githubToken",
    "accessToken",
    "api_key",
    "apiKey",
    "password",
    "clientSecret",
    "sessionId",
  ])("flags %s", (key) => expect(isSensitiveKey(key)).toBe(true));

  it.each(["tokenConfigured", "tokens", "path", "author", "status", "maxTokens"])(
    "allows %s",
    (key) => expect(isSensitiveKey(key)).toBe(false),
  );
});

describe("redactSecrets", () => {
  it("masks nested credential keys but keeps booleans and numbers", () => {
    expect(
      redactSecrets({
        request: { headers: { authorization: `Bearer ${CLASSIC}`, accept: "json" } },
        githubToken: CLASSIC,
        tokenConfigured: true,
        apiKey: 42,
        list: [{ password: "hunter2" }, `see ${CLASSIC}`],
      }),
    ).toEqual({
      request: { headers: { authorization: REDACTED, accept: "json" } },
      githubToken: REDACTED,
      tokenConfigured: true,
      apiKey: 42,
      list: [{ password: REDACTED }, `see ${REDACTED}`],
    });
  });

  it("serializes errors with redacted messages, stacks, properties and causes", () => {
    const cause = new Error(`inner ${CLASSIC}`);
    const error = new SourceError("UNAUTHORIZED", `rejected ${CLASSIC}`, { status: 401, cause });
    const result = redactSecrets(error) as Record<string, unknown>;
    expect(result).toMatchObject({
      name: "SourceError",
      message: `rejected ${REDACTED}`,
      code: "UNAUTHORIZED",
      status: 401,
      cause: { name: "Error", message: `inner ${REDACTED}` },
    });
    expect(JSON.stringify(result)).not.toContain(CLASSIC);
  });

  it("handles cycles, shared references, maps, sets, dates, URLs, bigints and functions", () => {
    const shared = { value: 1 };
    const cyclic: Record<string, unknown> = { shared, again: shared, when: new Date(0) };
    cyclic.self = cyclic;
    const result = redactSecrets({
      cyclic,
      map: new Map([["token", CLASSIC]]),
      set: new Set([1, 2]),
      url: new URL(`https://example.com/?access_token=${CLASSIC}`),
      big: 10n,
      fn: () => 1,
      headers: new Headers({ Authorization: "Bearer abc", "Content-Type": "text/plain" }),
    });
    expect(result).toEqual({
      cyclic: {
        shared: { value: 1 },
        again: { value: 1 },
        when: "1970-01-01T00:00:00.000Z",
        self: "[Circular]",
      },
      map: { token: REDACTED },
      set: [1, 2],
      url: `https://example.com/?access_token=${REDACTED}`,
      big: "10",
      headers: { authorization: REDACTED, "content-type": "text/plain" },
    });
  });

  it("bounds depth, array length and string length", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 20; index += 1) deep = { next: deep };
    expect(JSON.stringify(redactSecrets(deep))).toContain("[Object]");
    const long = redactSecrets(Array.from({ length: 500 }, (_, index) => index)) as unknown[];
    expect(long).toHaveLength(201);
    expect(long[200]).toBe("… 300 more items");
    expect((redactSecrets("x".repeat(20_000)) as string).length).toBeLessThan(9_000);
  });

  it("never mutates its input", () => {
    const input = { token: CLASSIC, nested: { authorization: "Bearer x" } };
    redactSecrets(input);
    expect(input).toEqual({ token: CLASSIC, nested: { authorization: "Bearer x" } });
  });
});
