import { describe, expect, it } from "vitest";
import { PARSE_ERROR_MESSAGES } from "@/lib/validation/repository-url";
import { suggestRepositoryFromPath } from "./path-suggestion";
import { resolveRepositoryTarget } from "./repository-target";

describe("resolveRepositoryTarget", () => {
  it("maps plain references to the explorer path", () => {
    expect(resolveRepositoryTarget("facebook/react")).toEqual({
      ok: true,
      href: "/explore/facebook/react",
      owner: "facebook",
      repo: "react",
      ref: undefined,
    });
  });

  it("carries a ref from tree, blob and commit URLs as a query parameter", () => {
    expect(resolveRepositoryTarget("https://github.com/o/r/tree/main/src")).toMatchObject({
      ok: true,
      href: "/explore/o/r?ref=main",
      ref: "main",
    });
    expect(resolveRepositoryTarget("https://github.com/o/r/blob/v1.2.3/a.ts")).toMatchObject({
      href: "/explore/o/r?ref=v1.2.3",
    });
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(resolveRepositoryTarget(`https://github.com/o/r/commit/${sha}`)).toMatchObject({
      href: `/explore/o/r?ref=${sha}`,
    });
  });

  it("ignores refs the parser considers unsafe", () => {
    expect(resolveRepositoryTarget("https://github.com/o/r/tree/..%2Fetc")).toMatchObject({
      ok: true,
      href: "/explore/o/r",
    });
  });

  it("keeps characters that are legal in repository names intact", () => {
    expect(resolveRepositoryTarget("https://github.com/vercel/next.js")).toMatchObject({
      href: "/explore/vercel/next.js",
    });
    expect(resolveRepositoryTarget("some-user/my_repo-1.0")).toMatchObject({
      href: "/explore/some-user/my_repo-1.0",
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://gitlab.com/a/b", "not-github"],
    ["https://github.com/facebook", "missing-repo"],
    ["https://github.com/-x/y", "invalid-owner"],
    ["a/..", "invalid-repo"],
  ] as const)("returns the user-facing message for %j", (input, reason) => {
    expect(resolveRepositoryTarget(input)).toEqual({
      ok: false,
      message: PARSE_ERROR_MESSAGES[reason],
    });
  });
});

describe("suggestRepositoryFromPath", () => {
  it.each([
    ["/facebook/react", "facebook/react", "/explore/facebook/react"],
    ["/facebook/react/", "facebook/react", "/explore/facebook/react"],
    ["/explore/vercel/next.js/extra", "vercel/next.js", "/explore/vercel/next.js"],
    ["/github.com/nodejs/node", "nodejs/node", "/explore/nodejs/node"],
    ["/facebook/react/tree/main/packages", "facebook/react", "/explore/facebook/react?ref=main"],
  ])("suggests a repository for %s", (pathname, label, href) => {
    expect(suggestRepositoryFromPath(pathname)).toEqual({ label, href });
  });

  it.each(["/", "/about", "/explore", "/explore/facebook", "/settings/profile", "/%E0%A4%A/x"])(
    "does not guess for %s",
    (pathname) => {
      expect(suggestRepositoryFromPath(pathname)).toBeNull();
    },
  );
});
