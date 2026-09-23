import { describe, expect, it } from "vitest";
import { SourceError } from "@/sources/types";
import {
  createFakeFetch,
  emptyResponse,
  jsonResponse,
  recordingSleep,
  streamResponse,
  textResponse,
  type FakeHandler,
} from "./__fixtures__/fake-fetch";
import { GitHubClient, type GitHubClientOptions } from "./client";

const TOKEN = "ghp_RAWTEST_abcdefghijklmnopqrstuvwxyz";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const encoder = new TextEncoder();

function setup(handler: FakeHandler, options: GitHubClientOptions = {}) {
  const fake = createFakeFetch(handler);
  const { sleep, delays } = recordingSleep();
  const client = new GitHubClient({ fetchImpl: fake.fetch, sleep, token: TOKEN, ...options });
  return { client, requests: fake.requests, delays };
}

describe("GitHubClient.getRawFile", () => {
  it("downloads from the raw host at the exact commit with an encoded path and no credentials", async () => {
    const { client, requests } = setup(() => textResponse("export const a = 1;\n"));
    const result = await client.getRawFile("facebook", "react", SHA, "src/a b/#x?.ts", {
      maxBytes: 1024,
    });
    expect(result).toEqual({ kind: "text", content: "export const a = 1;\n", size: 20 });
    const [request] = requests;
    expect(request?.url.href).toBe(
      `https://raw.githubusercontent.com/facebook/react/${SHA}/src/a%20b/%23x%3F.ts`,
    );
    expect(request?.headers.authorization).toBeUndefined();
    expect(JSON.stringify(request?.headers)).not.toContain(TOKEN);
    expect(request?.headers["user-agent"]).toBe("CodeVerse/0.1");
  });

  it("never sends the token on a raw redirect either", async () => {
    const { client, requests } = setup((request) =>
      request.url.pathname.endsWith("/old.txt")
        ? emptyResponse(301, { location: `/facebook/react/${SHA}/new.txt` })
        : textResponse("moved"),
    );
    await expect(
      client.getRawFile("facebook", "react", SHA, "old.txt", { maxBytes: 100 }),
    ).resolves.toMatchObject({
      kind: "text",
      content: "moved",
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.headers.authorization === undefined)).toBe(true);
  });

  it("returns too-large from Content-Length without reading the body", async () => {
    const chunk = new Uint8Array(1024);
    const { response, state } = streamResponse([chunk, chunk], {
      headers: { "content-length": "4096" },
    });
    const { client } = setup(() => response);
    await expect(client.getRawFile("o", "r", SHA, "big.bin", { maxBytes: 1000 })).resolves.toEqual({
      kind: "too-large",
      size: 4096,
    });
    expect(state.pulled).toBeLessThanOrEqual(1);
  });

  it("cancels a streamed download once it exceeds maxBytes", async () => {
    const chunk = encoder.encode("x".repeat(600));
    const { response, state } = streamResponse([chunk, chunk, chunk, chunk]);
    const { client } = setup(() => response);
    await expect(client.getRawFile("o", "r", SHA, "big.txt", { maxBytes: 1000 })).resolves.toEqual({
      kind: "too-large",
      size: 1200,
    });
    expect(state.cancelled).toBe(true);
  });

  it("caps maxBytes at the absolute ceiling", async () => {
    const { client } = setup(() => textResponse("x".repeat(50)), { absoluteMaxFileBytes: 10 });
    await expect(
      client.getRawFile("o", "r", SHA, "a.txt", { maxBytes: 1_000_000 }),
    ).resolves.toEqual({
      kind: "too-large",
      size: 50,
    });
  });

  it("detects binary content (NUL byte and control-byte ratio)", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const nul = setup(() => new Response(png));
    await expect(
      nul.client.getRawFile("o", "r", SHA, "logo.png", { maxBytes: 100 }),
    ).resolves.toEqual({
      kind: "binary",
      size: 10,
    });

    const controls = new Uint8Array(40).fill(0x02);
    controls.fill(0x41, 0, 20);
    const ratio = setup(() => new Response(controls));
    await expect(
      ratio.client.getRawFile("o", "r", SHA, "data.dat", { maxBytes: 100 }),
    ).resolves.toEqual({
      kind: "binary",
      size: 40,
    });
  });

  it("strips a UTF-8 BOM while reporting the byte size", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("héllo")]);
    const { client } = setup(() => new Response(bytes));
    await expect(client.getRawFile("o", "r", SHA, "bom.txt", { maxBytes: 100 })).resolves.toEqual({
      kind: "text",
      content: "héllo",
      size: 9,
    });
  });

  it("returns missing for 404 without retrying", async () => {
    const { client, requests } = setup(() => textResponse("404: Not Found", { status: 404 }));
    await expect(client.getRawFile("o", "r", SHA, "gone.ts", { maxBytes: 100 })).resolves.toEqual({
      kind: "missing",
    });
    expect(requests).toHaveLength(1);
  });

  it.each([403, 429])("maps HTTP %i to RATE_LIMITED", async (status) => {
    const { client } = setup(() =>
      textResponse("slow down", { status, headers: { "retry-after": "120" } }),
    );
    await expect(client.getRawFile("o", "r", SHA, "a.ts", { maxBytes: 100 })).rejects.toMatchObject(
      {
        code: "RATE_LIMITED",
        status,
      },
    );
  });

  it("retries a short raw-host throttle once its retry-after has passed", async () => {
    let calls = 0;
    const { client, delays } = setup(() => {
      calls += 1;
      return calls === 1
        ? textResponse("slow down", { status: 429, headers: { "retry-after": "1" } })
        : textResponse("ok");
    });
    await expect(
      client.getRawFile("o", "r", SHA, "a.ts", { maxBytes: 100 }),
    ).resolves.toMatchObject({
      kind: "text",
      content: "ok",
    });
    expect(delays[0]).toBeGreaterThanOrEqual(1_000);
  });

  it("retries 5xx and reports UPSTREAM_ERROR when it persists", async () => {
    const { client, requests, delays } = setup(() => textResponse("unavailable", { status: 503 }));
    await expect(client.getRawFile("o", "r", SHA, "a.ts", { maxBytes: 100 })).rejects.toMatchObject(
      {
        code: "UPSTREAM_ERROR",
        status: 503,
      },
    );
    expect(requests).toHaveLength(3);
    expect(delays).toHaveLength(2);
  });

  it("recovers when a retry succeeds", async () => {
    let calls = 0;
    const { client } = setup(() => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, { status: 500 }) : textResponse("ok");
    });
    await expect(
      client.getRawFile("o", "r", SHA, "a.ts", { maxBytes: 100 }),
    ).resolves.toMatchObject({
      kind: "text",
      content: "ok",
    });
  });

  it.each([
    ["short sha", "o", "r", "abc123", "a.ts"],
    ["branch name", "o", "r", "main", "a.ts"],
    ["bad owner", "evil.com", "r", SHA, "a.ts"],
    ["bad repo", "o", "../x", SHA, "a.ts"],
    ["traversal path", "o", "r", SHA, "../../etc/passwd"],
    ["absolute path", "o", "r", SHA, "/etc/passwd"],
  ])(
    "rejects %s with INVALID_REPOSITORY before any request",
    async (_label, owner, repo, sha, path) => {
      const { client, requests } = setup(() => textResponse("x"));
      const error = await client
        .getRawFile(owner, repo, sha, path, { maxBytes: 10 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SourceError);
      expect(error).toMatchObject({ code: "INVALID_REPOSITORY" });
      expect(requests).toHaveLength(0);
    },
  );
});
