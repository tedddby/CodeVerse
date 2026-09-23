import { describe, expect, it } from "vitest";
import { SourceError, isSourceError } from "./types";

describe("isSourceError", () => {
  it("recognizes SourceErrors and subclasses", () => {
    class ProviderError extends SourceError {}
    expect(isSourceError(new SourceError("NOT_FOUND", "missing"))).toBe(true);
    expect(isSourceError(new ProviderError("RATE_LIMITED", "slow down"))).toBe(true);
  });

  it("recognizes errors created by another bundled copy of the module", () => {
    // Simulates a duplicate class from a different server chunk: same brand, different constructor.
    const brand = Symbol.for("codeverse.SourceError");
    const foreign = Object.assign(new Error("The GitHub API rate limit is exhausted."), {
      [brand]: true,
      code: "RATE_LIMITED",
      retryAt: "2026-09-23T19:37:09.000Z",
    });
    expect(foreign instanceof SourceError).toBe(false);
    expect(isSourceError(foreign)).toBe(true);
  });

  it("rejects look-alikes without the brand", () => {
    expect(isSourceError(Object.assign(new Error("x"), { code: "RATE_LIMITED" }))).toBe(false);
    expect(isSourceError(null)).toBe(false);
    expect(isSourceError("RATE_LIMITED")).toBe(false);
  });
});
