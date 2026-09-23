import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { graphCacheKey, latestGraphPointerKey, limitsHash } from "./cache-key";
import { ANALYZER_VERSION } from "./version";

const REPOSITORY = {
  id: "github:Acme/Widget",
  commitSha: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
};
const CAPABILITIES = { fileHistory: true, commitCounts: true };

describe("graphCacheKey", () => {
  it("combines the analyzer version, repository, commit and settings", () => {
    expect(graphCacheKey(REPOSITORY, DEFAULT_LIMITS, CAPABILITIES)).toBe(
      `${ANALYZER_VERSION}:github:Acme/Widget@abcdef0123456789abcdef0123456789abcdef01:${limitsHash(DEFAULT_LIMITS, CAPABILITIES)}`,
    );
  });

  it("changes when a graph-affecting limit or capability changes", () => {
    const base = graphCacheKey(REPOSITORY, DEFAULT_LIMITS, CAPABILITIES);
    expect(
      graphCacheKey(REPOSITORY, { ...DEFAULT_LIMITS, maxParsedFiles: 10 }, CAPABILITIES),
    ).not.toBe(base);
    expect(
      graphCacheKey(REPOSITORY, DEFAULT_LIMITS, { fileHistory: false, commitCounts: false }),
    ).not.toBe(base);
    expect(
      graphCacheKey({ ...REPOSITORY, commitSha: "0".repeat(40) }, DEFAULT_LIMITS, CAPABILITIES),
    ).not.toBe(base);
  });

  it("ignores settings that do not change the graph", () => {
    const base = graphCacheKey(REPOSITORY, DEFAULT_LIMITS, CAPABILITIES);
    expect(
      graphCacheKey(
        REPOSITORY,
        { ...DEFAULT_LIMITS, fetchConcurrency: 2, requestTimeoutMs: 1 },
        CAPABILITIES,
      ),
    ).toBe(base);
  });

  it("produces short hex digests", () => {
    expect(limitsHash(DEFAULT_LIMITS)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("latestGraphPointerKey", () => {
  it("is case-insensitive per repository", () => {
    expect(latestGraphPointerKey("github:Acme/Widget")).toBe(
      latestGraphPointerKey("github:acme/widget"),
    );
    expect(latestGraphPointerKey("github:acme/widget")).toBe(
      `${ANALYZER_VERSION}:latest:github:acme/widget`,
    );
  });
});
