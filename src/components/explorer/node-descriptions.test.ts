import { beforeEach, describe, expect, it } from "vitest";
import type { GraphIndex } from "@/graph/model/graph-index";
import {
  countFileSymbols,
  dependentFileIds,
  describeSelection,
  initialsOf,
  isTrustedAvatarUrl,
  lineRangeLabel,
} from "./node-descriptions";
import { directoryRef, fileRef, loadMockGraph, symbolRef } from "./test-utils";

let index: GraphIndex;

beforeEach(() => {
  index = loadMockGraph();
});

describe("describeSelection", () => {
  it("describes files, directories, the root and symbols", () => {
    expect(describeSelection(fileRef("src/auth/auth.ts"), index)).toBe("Selected file src/auth/auth.ts, TypeScript, 842 lines");
    expect(describeSelection(fileRef("docs/diagrams/overview.png"), index)).toBe(
      "Selected file docs/diagrams/overview.png, Other, binary file",
    );
    expect(describeSelection(directoryRef("src/auth"), index)).toBe("Selected directory src/auth, 4 files");
    expect(describeSelection({ kind: "directory", id: "dir:" }, index)).toMatch(/^Selected repository root codeverse-demo\/acme-platform, \d+ files$/);
    expect(describeSelection(symbolRef("src/auth/auth.ts", "authenticate", 44), index)).toBe(
      "Selected method authenticate in src/auth/auth.ts, lines 44–120",
    );
  });

  it("is empty for no selection or unknown nodes", () => {
    expect(describeSelection(null, index)).toBe("");
    expect(describeSelection(fileRef("nope.ts"), index)).toBe("");
    expect(describeSelection(fileRef("src/index.ts"), null)).toBe("");
  });
});

describe("file metrics", () => {
  it("counts functions (incl. methods) and classes (incl. structs)", () => {
    const auth = index.filesById.get("file:src/auth/auth.ts");
    const invoice = index.filesById.get("file:services/billing/invoice.go");
    expect(auth && countFileSymbols(auth, index)).toEqual({ functions: 6, classes: 1, total: 8 });
    expect(invoice && countFileSymbols(invoice, index)).toEqual({ functions: 1, classes: 1, total: 2 });
  });

  it("lists distinct dependents", () => {
    expect(dependentFileIds("file:src/lib/config.ts", index).sort()).toEqual(
      ["file:src/auth/jwt.ts", "file:src/index.ts", "file:src/lib/db.ts", "file:src/payments/stripe.ts"].sort(),
    );
  });

  it("labels line ranges", () => {
    expect(lineRangeLabel({ startLine: 3, endLine: 3 })).toBe("line 3");
    expect(lineRangeLabel({ startLine: 1_000, endLine: 1_200 })).toBe("lines 1,000–1,200");
  });
});

describe("avatar helpers", () => {
  it("only trusts https avatars from GitHub's CDN", () => {
    expect(isTrustedAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(true);
    expect(isTrustedAvatarUrl("http://avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isTrustedAvatarUrl("https://avatars.githubusercontent.com.evil.com/u/1")).toBe(false);
    expect(isTrustedAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedAvatarUrl(undefined)).toBe(false);
  });

  it("derives initials", () => {
    expect(initialsOf("Ada Octo")).toBe("AO");
    expect(initialsOf("octo-bruno")).toBe("OB");
    expect(initialsOf("linus")).toBe("L");
    expect(initialsOf("  ")).toBe("?");
  });
});
