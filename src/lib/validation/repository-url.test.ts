import { describe, expect, it } from "vitest";
import { explorePath, isValidRef, parseRepositoryInput } from "./repository-url";

describe("parseRepositoryInput", () => {
  it.each([
    ["facebook/react", "facebook", "react"],
    ["  facebook/react  ", "facebook", "react"],
    ["github.com/facebook/react", "facebook", "react"],
    ["www.github.com/facebook/react", "facebook", "react"],
    ["https://github.com/facebook/react", "facebook", "react"],
    ["http://github.com/facebook/react", "facebook", "react"],
    ["https://github.com/facebook/react/", "facebook", "react"],
    ["https://github.com/facebook/react.git", "facebook", "react"],
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/facebook/react?tab=readme", "facebook", "react"],
    ["https://github.com/facebook/react#readme", "facebook", "react"],
    ["git@github.com:torvalds/linux.git", "torvalds", "linux"],
    ["https://github.com/some-user/my_repo-1.0", "some-user", "my_repo-1.0"],
  ])("parses %s", (input, owner, repo) => {
    const result = parseRepositoryInput(input);
    expect(result).toMatchObject({ ok: true, owner, repo });
  });

  it("extracts ref and path from tree/blob URLs", () => {
    expect(parseRepositoryInput("https://github.com/facebook/react/tree/main/packages/react")).toEqual({
      ok: true,
      owner: "facebook",
      repo: "react",
      ref: "main",
      path: "packages/react",
    });
    expect(parseRepositoryInput("https://github.com/facebook/react/blob/v18.2.0/README.md")).toEqual({
      ok: true,
      owner: "facebook",
      repo: "react",
      ref: "v18.2.0",
      path: "README.md",
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["react", "not-github"],
    ["https://gitlab.com/facebook/react", "not-github"],
    ["https://github.com.evil.com/facebook/react", "not-github"],
    ["https://evil.com/github.com/facebook/react", "not-github"],
    ["ftp://github.com/facebook/react", "not-github"],
    ["https://user:pass@github.com/facebook/react", "not-github"],
    ["https://github.com:8443/facebook/react", "not-github"],
    ["javascript:alert(1)", "not-github"],
    ["https://github.com/facebook", "missing-repo"],
    ["https://github.com/-bad/react", "invalid-owner"],
    ["https://github.com/bad--/react", "invalid-owner"],
    ["https://github.com/settings/profile", "invalid-owner"],
    ["facebook/..", "invalid-repo"],
    // The URL parser resolves dot segments first, leaving no repository at all.
    ["https://github.com/facebook/..", "not-github"],
    ["https://github.com/facebook/re%20act", "invalid-repo"],
    ["https://github.com/facebook/%E0%A4%A", "not-github"],
  ])("rejects %j (%s)", (input, reason) => {
    expect(parseRepositoryInput(input)).toEqual({ ok: false, reason });
  });

  it("drops deep-link paths containing traversal segments", () => {
    const result = parseRepositoryInput("a/b/tree/main/../../etc/passwd");
    expect(result).toMatchObject({ ok: true, owner: "a", repo: "b", ref: "main" });
    expect(result.ok && result.path).toBeFalsy();
  });

  it("never yields traversal segments from URL input", () => {
    // WHATWG URL parsing resolves "..", so the path can never escape the repository.
    const result = parseRepositoryInput("https://github.com/a/b/tree/main/src/../../../etc/passwd");
    expect(result).toMatchObject({ ok: true, owner: "a", repo: "b" });
    if (result.ok) expect(result.path ?? "").not.toContain("..");
  });

  it("rejects oversized input", () => {
    expect(parseRepositoryInput(`a/${"b".repeat(5000)}`).ok).toBe(false);
  });
});

describe("isValidRef", () => {
  it.each(["main", "v1.2.3", "feature/x", "a".repeat(40)])("accepts %s", (ref) => {
    expect(isValidRef(ref)).toBe(true);
  });
  it.each(["", "a..b", "/main", "main/", "x.lock", "a//b", "has space", "semi;colon"])("rejects %j", (ref) => {
    expect(isValidRef(ref)).toBe(false);
  });
});

describe("explorePath", () => {
  it("builds canonical explorer paths", () => {
    expect(explorePath("vercel", "next.js")).toBe("/explore/vercel/next.js");
  });
});
