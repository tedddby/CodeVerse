import path from "node:path";
import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import {
  DEFAULT_CACHE_MAX_MB,
  createGraphCache,
  describeGraphCacheConfig,
  isStoredGraph,
  readGraphCacheConfig,
} from "./graph-cache";
import { MemoryCache } from "./memory-cache";
import { TieredCache } from "./tiered-cache";

describe("graph cache configuration", () => {
  it("defaults to a 256 MB memory cache without a disk tier", () => {
    const config = readGraphCacheConfig({});
    expect(config).toEqual({ memoryMaxBytes: DEFAULT_CACHE_MAX_MB * 1024 * 1024, directory: null });
    expect(describeGraphCacheConfig(config)).toBe("memory (256 MB)");
    expect(createGraphCache(config)).toBeInstanceOf(MemoryCache);
  });

  it("reads the size and directory from the environment", () => {
    const config = readGraphCacheConfig({
      CODEVERSE_CACHE_MAX_MB: "64",
      CODEVERSE_CACHE_DIR: ".cache/cv",
    });
    expect(config.memoryMaxBytes).toBe(64 * 1024 * 1024);
    expect(config.directory).toBe(path.resolve(".cache/cv"));
    expect(describeGraphCacheConfig(config)).toBe("memory (64 MB) + disk");
    expect(createGraphCache(config)).toBeInstanceOf(TieredCache);
  });

  it("ignores invalid sizes", () => {
    expect(readGraphCacheConfig({ CODEVERSE_CACHE_MAX_MB: "lots" }).memoryMaxBytes).toBe(
      DEFAULT_CACHE_MAX_MB * 1024 * 1024,
    );
    expect(readGraphCacheConfig({ CODEVERSE_CACHE_MAX_MB: "0" }).memoryMaxBytes).toBe(0);
  });
});

describe("isStoredGraph", () => {
  it("accepts real graphs and rejects foreign shapes", () => {
    expect(isStoredGraph(structuredClone(mockRepositoryGraph))).toBe(true);
    expect(isStoredGraph(null)).toBe(false);
    expect(isStoredGraph({ ...structuredClone(mockRepositoryGraph), schemaVersion: 999 })).toBe(
      false,
    );
    expect(isStoredGraph({ ...structuredClone(mockRepositoryGraph), files: "nope" })).toBe(false);
    expect(isStoredGraph({ ...structuredClone(mockRepositoryGraph), repository: null })).toBe(
      false,
    );
  });
});
