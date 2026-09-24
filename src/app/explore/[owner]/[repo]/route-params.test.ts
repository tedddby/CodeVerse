import { describe, expect, it } from "vitest";
import { parseRepositoryParams } from "./route-params";

describe("parseRepositoryParams", () => {
  it("accepts valid owners and repository names", () => {
    expect(parseRepositoryParams({ owner: "facebook", repo: "react" })).toEqual({
      owner: "facebook",
      repo: "react",
    });
    expect(parseRepositoryParams({ owner: "vercel", repo: "next.js" })).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("decodes percent-encoded segments before validating", () => {
    expect(parseRepositoryParams({ owner: "fa%63ebook", repo: "re%61ct" })).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("rejects invalid, reserved, traversal and malformed segments", () => {
    expect(parseRepositoryParams({ owner: "-bad", repo: "react" })).toBeNull();
    expect(parseRepositoryParams({ owner: "settings", repo: "react" })).toBeNull();
    expect(parseRepositoryParams({ owner: "facebook", repo: ".." })).toBeNull();
    expect(parseRepositoryParams({ owner: "facebook", repo: "react.git" })).toBeNull();
    expect(parseRepositoryParams({ owner: "facebook", repo: "%E0%A4%A" })).toBeNull();
    expect(parseRepositoryParams({ owner: "face%2Fbook", repo: "react" })).toBeNull();
    expect(parseRepositoryParams({ owner: "facebook", repo: "<script>" })).toBeNull();
  });
});
