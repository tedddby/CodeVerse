import { describe, expect, it } from "vitest";
import { SourceError } from "@/sources/types";
import { encodeRepositoryPath, sanitizeRepositoryPath } from "./paths";
import {
  assertCommitSha,
  assertOwner,
  assertRepoName,
  assertUserRef,
  encodeRef,
  isCommitSha,
  isSafeApiRef,
  repoApiPath,
} from "./validation";

describe("sanitizeRepositoryPath", () => {
  it.each([
    "README.md",
    "src/index.ts",
    "packages/react-dom/src/client/ReactDOM.js",
    ".github/workflows/ci.yml",
    "docs/Grüße/über.md",
    "weird name with spaces/#hash?.txt",
    "a/.../b", // three dots is a regular name
    "back\\slash.txt",
    "emoji/🚀.md",
  ])("accepts %j unchanged", (path) => {
    expect(sanitizeRepositoryPath(path)).toBe(path);
  });

  it.each([
    ["empty", ""],
    ["absolute", "/etc/passwd"],
    ["parent segment", "../secrets"],
    ["nested parent segment", "src/../../x"],
    ["current segment", "./src/index.ts"],
    ["trailing current segment", "src/."],
    ["empty segment", "src//index.ts"],
    ["trailing slash", "src/"],
    ["NUL", "src/a\u0000b.ts"],
    ["newline", "src/a\nb.ts"],
    ["escape", "src/\u001b[31mred.ts"],
    ["DEL", "src/a\u007fb.ts"],
    ["encoded dot-dot", "src/%2e%2e/x"],
    ["mixed encoded dot-dot", "src/.%2E/x"],
    ["lone surrogate", "src/\ud800.ts"],
  ])("rejects %s", (_label, path) => {
    expect(sanitizeRepositoryPath(path)).toBeNull();
  });

  it("enforces the maximum length", () => {
    expect(sanitizeRepositoryPath("a".repeat(10), 10)).toBe("a".repeat(10));
    expect(sanitizeRepositoryPath("a".repeat(11), 10)).toBeNull();
    expect(sanitizeRepositoryPath("a".repeat(1_025))).toBeNull();
  });

  it("rejects non-string input defensively", () => {
    expect(sanitizeRepositoryPath(42 as unknown as string)).toBeNull();
  });
});

describe("encodeRepositoryPath", () => {
  it("percent-encodes each segment and keeps separators", () => {
    expect(encodeRepositoryPath("docs/a b/#1?.md")).toBe("docs/a%20b/%231%3F.md");
    expect(encodeRepositoryPath("src/über.ts")).toBe("src/%C3%BCber.ts");
    expect(encodeRepositoryPath("%2e%2e/x")).toBe("%252e%252e/x");
  });
});

describe("URL component validation", () => {
  it("recognizes full commit SHAs only", () => {
    expect(isCommitSha("a".repeat(40))).toBe(true);
    expect(isCommitSha("A".repeat(40))).toBe(true);
    expect(isCommitSha("a".repeat(39))).toBe(false);
    expect(isCommitSha("g".repeat(40))).toBe(false);
    expect(assertCommitSha("ABCDEF".padEnd(40, "0"))).toBe("abcdef".padEnd(40, "0"));
    expect(() => assertCommitSha("main")).toThrowError(SourceError);
  });

  it("rejects malformed owners, repositories and refs with INVALID_REPOSITORY", () => {
    for (const run of [
      () => assertOwner("-bad"),
      () => assertOwner("evil.com/x"),
      () => assertRepoName("../etc"),
      () => assertRepoName("a/b"),
      () => assertUserRef("main..dev"),
      () => assertUserRef("feature/"),
      () => assertUserRef("a b"),
    ]) {
      expect(run).toThrowError(expect.objectContaining({ code: "INVALID_REPOSITORY" }));
    }
    expect(assertOwner("facebook")).toBe("facebook");
    expect(assertRepoName("react.dev")).toBe("react.dev");
    expect(assertUserRef("release/v1.2.3")).toBe("release/v1.2.3");
  });

  it("accepts unusual but structurally safe API refs and encodes them", () => {
    expect(isSafeApiRef("main")).toBe(true);
    expect(isSafeApiRef("feature/ünïcode+x@y")).toBe(true);
    expect(isSafeApiRef("a/../b")).toBe(false);
    expect(isSafeApiRef("a//b")).toBe(false);
    expect(isSafeApiRef("bad\nref")).toBe(false);
    expect(isSafeApiRef("")).toBe(false);
    expect(encodeRef("feature/a+b#c")).toBe("feature/a%2Bb%23c");
  });

  it("builds repository API paths from validated components only", () => {
    expect(repoApiPath("facebook", "react")).toBe("/repos/facebook/react");
    expect(() => repoApiPath("facebook", "react/../../orgs")).toThrowError(
      expect.objectContaining({ code: "INVALID_REPOSITORY" }),
    );
  });
});
