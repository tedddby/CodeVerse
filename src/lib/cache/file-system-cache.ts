import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import { silentLogger, type Logger } from "@/lib/observability/logger";
import type { Cache, CacheSetOptions } from "./types";

/**
 * Persistent cache of JSON-serializable values in one directory.
 *
 * - One file per key: `sha256(key).json.gz`. Keys never become path segments,
 *   so no key can address a file outside the directory.
 * - Records embed their key and expiry and are validated on read; corrupt,
 *   truncated, foreign or tampered files are treated as misses and removed.
 *   Symlinks and non-regular files are never followed.
 * - Writes go to a unique temporary file that is renamed into place, so
 *   readers never observe a partially written record.
 * - The directory is bounded: after writes, expired records and the oldest
 *   records beyond `maxBytes` are pruned (at most once per prune interval).
 * - All failures are logged and swallowed: a broken disk degrades to misses.
 */

export interface FileSystemCacheOptions<V> {
  directory: string;
  /** Default time to live (default 7 days). */
  defaultTtlMs?: number;
  /** Size bound for the directory's records (default 1 GiB). */
  maxBytes?: number;
  /** Structural validation of values read back from disk. */
  validate?: (value: unknown) => value is V;
  logger?: Logger;
  /** Clock (epoch milliseconds), injectable for tests. */
  now?: () => number;
  /** Refuse to decompress records larger than this (default 1 GiB). */
  maxDecompressedBytes?: number;
}

interface StoredRecord {
  format: typeof RECORD_FORMAT;
  key: string;
  expiresAt: number;
  value: unknown;
}

const RECORD_FORMAT = 1;
const DAY_MS = 86_400_000;
const DEFAULT_TTL_MS = 7 * DAY_MS;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const PRUNE_INTERVAL_MS = 10 * 60_000;
/** Temporary files older than this are leftovers of crashed writes. */
const STALE_TEMP_MS = 60 * 60_000;
const RECORD_FILE = /^[0-9a-f]{64}\.json\.gz$/;
const TEMP_FILE = /^\.[0-9a-f]{64}\.[0-9a-f-]{36}\.tmp$/;
const RENAME_ATTEMPTS = 4;

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isRecord(value: unknown): value is StoredRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<StoredRecord>;
  return (
    record.format === RECORD_FORMAT &&
    typeof record.key === "string" &&
    typeof record.expiresAt === "number" &&
    "value" in record
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FileSystemCache<V> implements Cache<V> {
  readonly #directory: string;
  readonly #defaultTtlMs: number;
  readonly #maxBytes: number;
  readonly #validate: ((value: unknown) => value is V) | undefined;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #maxDecompressedBytes: number;
  #ready: Promise<void> | null = null;
  #lastPruneAt = Number.NEGATIVE_INFINITY;
  #pruning: Promise<void> | null = null;

  constructor(options: FileSystemCacheOptions<V>) {
    this.#directory = path.resolve(options.directory);
    this.#defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#validate = options.validate;
    this.#logger = options.logger ?? silentLogger;
    this.#now = options.now ?? Date.now;
    this.#maxDecompressedBytes = options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;
  }

  /** Absolute cache directory. */
  get directory(): string {
    return this.#directory;
  }

  async get(key: string): Promise<V | undefined> {
    const file = this.#fileFor(key);
    try {
      const stats = await lstat(file);
      if (!stats.isFile()) {
        // A symlink or directory in place of a record is never followed.
        await this.#removeFile(file);
        return undefined;
      }
      const compressed = await readFile(file);
      let record: unknown;
      try {
        const json = await gunzip(compressed, { maxOutputLength: this.#maxDecompressedBytes });
        record = JSON.parse(json.toString("utf8"));
      } catch {
        this.#logger.warn("cache record is corrupt; removing it", {
          cacheFile: path.basename(file),
        });
        await this.#removeFile(file);
        return undefined;
      }
      if (!isRecord(record) || record.key !== key) return undefined;
      if (record.expiresAt <= this.#now()) {
        await this.#removeFile(file);
        return undefined;
      }
      if (this.#validate && !this.#validate(record.value)) {
        this.#logger.warn("cache record failed validation; removing it", {
          cacheFile: path.basename(file),
        });
        await this.#removeFile(file);
        return undefined;
      }
      return record.value as V;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        this.#logger.warn("cache read failed", { error, cacheFile: path.basename(file) });
      }
      return undefined;
    }
  }

  async set(key: string, value: V, options: CacheSetOptions = {}): Promise<void> {
    const file = this.#fileFor(key);
    const ttlMs =
      options.ttlMs !== undefined && Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? options.ttlMs
        : this.#defaultTtlMs;
    const temp = path.join(
      this.#directory,
      `.${path.basename(file, ".json.gz")}.${randomUUID()}.tmp`,
    );
    try {
      // Serializing a large value is CPU work: let the caller finish its synchronous path first.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record: StoredRecord = {
        format: RECORD_FORMAT,
        key,
        expiresAt: this.#now() + ttlMs,
        value,
      };
      const compressed = await gzip(Buffer.from(JSON.stringify(record), "utf8"));
      await this.#ensureDirectory();
      // "wx" fails instead of following anything that already exists at the temp path.
      await writeFile(temp, compressed, { flag: "wx", mode: 0o600 });
      await this.#renameIntoPlace(temp, file);
    } catch (error) {
      this.#logger.warn("cache write failed", { error, cacheFile: path.basename(file) });
      await this.#removeFile(temp);
      return;
    }
    this.#schedulePrune();
  }

  async delete(key: string): Promise<void> {
    await this.#removeFile(this.#fileFor(key));
  }

  /**
   * Removes expired records (by age), stale temporary files, and the oldest
   * records while the directory exceeds `maxBytes`. Files that do not look
   * like cache records are never touched.
   */
  async prune(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") this.#logger.warn("cache prune failed", { error });
      return;
    }
    const now = this.#now();
    const records: Array<{ file: string; size: number; mtimeMs: number }> = [];
    for (const name of names) {
      const file = path.join(this.#directory, name);
      const isRecordFile = RECORD_FILE.test(name);
      if (!isRecordFile && !TEMP_FILE.test(name)) continue;
      try {
        const stats = await lstat(file);
        if (!stats.isFile()) continue;
        if (!isRecordFile) {
          if (now - stats.mtimeMs > STALE_TEMP_MS) await this.#removeFile(file);
          continue;
        }
        if (now - stats.mtimeMs > this.#defaultTtlMs) await this.#removeFile(file);
        else records.push({ file, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch {
        // Vanished between listing and stat: nothing to prune.
      }
    }
    let total = records.reduce((sum, record) => sum + record.size, 0);
    records.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const record of records) {
      if (total <= this.#maxBytes) break;
      await this.#removeFile(record.file);
      total -= record.size;
    }
  }

  #fileFor(key: string): string {
    const name = `${createHash("sha256").update(key, "utf8").digest("hex")}.json.gz`;
    const file = path.join(this.#directory, name);
    // Defense in depth: the name is a hex digest, so this can only fail if path handling is broken.
    if (path.dirname(file) !== this.#directory) throw new Error("Cache path escaped its directory");
    return file;
  }

  #ensureDirectory(): Promise<void> {
    this.#ready ??= mkdir(this.#directory, { recursive: true, mode: 0o700 }).then(
      () => undefined,
      (error: unknown) => {
        this.#ready = null;
        throw error;
      },
    );
    return this.#ready;
  }

  async #renameIntoPlace(temp: string, file: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temp, file);
        return;
      } catch (error) {
        // Windows refuses to replace a file another reader has open; retry briefly.
        const code = errorCode(error);
        const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
        if (!transient || attempt >= RENAME_ATTEMPTS) throw error;
        await delay(25 * attempt);
      }
    }
  }

  async #removeFile(file: string): Promise<void> {
    try {
      await unlink(file);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        this.#logger.debug("cache file removal failed", { error, cacheFile: path.basename(file) });
      }
    }
  }

  #schedulePrune(): void {
    const now = this.#now();
    if (this.#pruning || now - this.#lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.#lastPruneAt = now;
    this.#pruning = this.prune()
      .catch((error: unknown) => this.#logger.warn("cache prune failed", { error }))
      .finally(() => {
        this.#pruning = null;
      });
  }
}
