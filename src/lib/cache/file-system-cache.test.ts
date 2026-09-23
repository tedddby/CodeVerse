import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemCache } from "./file-system-cache";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "codeverse-fs-cache-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function recordFile(key: string): string {
  return path.join(directory, `${createHash("sha256").update(key).digest("hex")}.json.gz`);
}

async function recordFiles(): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.endsWith(".json.gz"));
}

interface Payload {
  name: string;
  values: number[];
}

function isPayload(value: unknown): value is Payload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Payload).name === "string" &&
    Array.isArray((value as Payload).values)
  );
}

describe("FileSystemCache", () => {
  it("round-trips values through gzip records named by the key hash", async () => {
    const cache = new FileSystemCache<Payload>({ directory, validate: isPayload });
    const value = { name: "graph", values: [1, 2, 3] };
    await cache.set("v1:github:acme/repo@sha", value);
    expect(await recordFiles()).toEqual([path.basename(recordFile("v1:github:acme/repo@sha"))]);
    expect(await cache.get("v1:github:acme/repo@sha")).toEqual(value);
    expect(await cache.get("other")).toBeUndefined();
  });

  it("creates the directory lazily and keeps hostile keys inside it", async () => {
    const nested = path.join(directory, "a", "b");
    const cache = new FileSystemCache<string>({ directory: nested });
    await cache.set("../../../../etc/passwd", "value");
    await cache.set("C:\\Windows\\System32", "value");
    expect((await readdir(nested)).every((name) => /^[0-9a-f]{64}\.json\.gz$/.test(name))).toBe(
      true,
    );
    expect(await cache.get("../../../../etc/passwd")).toBe("value");
  });

  it("expires records after their TTL and removes them", async () => {
    let now = Date.now();
    const cache = new FileSystemCache<string>({ directory, defaultTtlMs: 1_000, now: () => now });
    await cache.set("key", "value");
    now += 999;
    expect(await cache.get("key")).toBe("value");
    now += 1;
    expect(await cache.get("key")).toBeUndefined();
    expect(await recordFiles()).toEqual([]);
  });

  it("treats corrupt, truncated and foreign records as misses and removes corrupt ones", async () => {
    const cache = new FileSystemCache<string>({ directory });
    await mkdir(directory, { recursive: true });
    await writeFile(recordFile("corrupt"), "not gzip at all");
    expect(await cache.get("corrupt")).toBeUndefined();
    expect(await recordFiles()).toEqual([]);

    const valid = gzipSync(
      JSON.stringify({ format: 1, key: "truncated", expiresAt: Date.now() + 1e6, value: "x" }),
    );
    await writeFile(recordFile("truncated"), valid.subarray(0, valid.length - 8));
    expect(await cache.get("truncated")).toBeUndefined();

    // A record stored under another key (e.g. copied by hand) is never returned.
    await writeFile(
      recordFile("mine"),
      gzipSync(
        JSON.stringify({ format: 1, key: "theirs", expiresAt: Date.now() + 1e6, value: "x" }),
      ),
    );
    expect(await cache.get("mine")).toBeUndefined();
  });

  it("rejects values that fail validation", async () => {
    const writer = new FileSystemCache<unknown>({ directory });
    await writer.set("key", { name: 42 });
    const reader = new FileSystemCache<Payload>({ directory, validate: isPayload });
    expect(await reader.get("key")).toBeUndefined();
    expect(await recordFiles()).toEqual([]);
  });

  it("never follows a symlink placed where a record should be", async () => {
    const outside = path.join(directory, "..", `outside-${path.basename(directory)}.txt`);
    await writeFile(outside, "secret");
    await mkdir(directory, { recursive: true });
    try {
      await symlink(outside, recordFile("key"));
    } catch {
      // Creating symlinks needs extra privileges on Windows; nothing to verify then.
      await rm(outside, { force: true });
      return;
    }
    const cache = new FileSystemCache<string>({ directory });
    expect(await cache.get("key")).toBeUndefined();
    expect((await stat(outside)).isFile()).toBe(true);
    await rm(outside, { force: true });
  });

  it("overwrites existing records atomically", async () => {
    const cache = new FileSystemCache<string>({ directory });
    await cache.set("key", "first");
    await cache.set("key", "second");
    expect(await cache.get("key")).toBe("second");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("swallows write failures", async () => {
    const blocker = path.join(directory, "blocker");
    await writeFile(blocker, "a file where the directory should be");
    const cache = new FileSystemCache<string>({ directory: path.join(blocker, "cache") });
    await expect(cache.set("key", "value")).resolves.toBeUndefined();
    expect(await cache.get("key")).toBeUndefined();
  });

  it("deletes records", async () => {
    const cache = new FileSystemCache<string>({ directory });
    await cache.set("key", "value");
    await cache.delete("key");
    await cache.delete("never-written");
    expect(await cache.get("key")).toBeUndefined();
  });

  it("prunes old records, stale temp files and the oldest records beyond maxBytes", async () => {
    const now = Date.now();
    const writer = new FileSystemCache<string>({ directory, defaultTtlMs: 60_000, now: () => now });
    await writer.set("old", "x");
    await writer.set("older", "y");
    await writer.set("newest", "z");
    const past = (ms: number) => new Date(now - ms);
    await utimes(recordFile("old"), past(120_000), past(120_000));
    await utimes(recordFile("older"), past(30_000), past(30_000));
    const staleTemp = path.join(
      directory,
      `.${"a".repeat(64)}.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.tmp`,
    );
    await writeFile(staleTemp, "partial");
    await utimes(staleTemp, past(7_200_000), past(7_200_000));
    await writeFile(path.join(directory, "README.txt"), "not ours");

    // Room for exactly one record: the oldest live record has to go.
    const oneRecord = (await stat(recordFile("newest"))).size;
    const pruner = new FileSystemCache<string>({
      directory,
      defaultTtlMs: 60_000,
      maxBytes: oneRecord,
      now: () => now,
    });
    await pruner.prune();
    const remaining = await readdir(directory);
    expect(remaining.sort()).toEqual([path.basename(recordFile("newest")), "README.txt"].sort());
  });
});
