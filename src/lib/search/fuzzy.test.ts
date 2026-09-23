import { describe, expect, it } from "vitest";
import {
  characterMask,
  fuzzyMatch,
  fuzzyScore,
  isSubsequence,
  MAX_TARGET_LENGTH,
  maxFuzzyScore,
  NO_MATCH,
  prepareQuery,
} from "./fuzzy";

function score(query: string, target: string): number {
  return fuzzyScore(prepareQuery(query), target, target.toLowerCase());
}

function positions(query: string, target: string): number[] | undefined {
  return fuzzyMatch(prepareQuery(query), target, target.toLowerCase())?.positions;
}

describe("prepareQuery", () => {
  it("strips whitespace, normalizes separators and lower-cases", () => {
    expect(prepareQuery("  Auth  Service ")).toEqual({
      original: "AuthService",
      lower: "authservice",
    });
    expect(prepareQuery("src\\auth").lower).toBe("src/auth");
  });
});

describe("characterMask", () => {
  it("never rejects a real subsequence", () => {
    const pairs: Array<[string, string]> = [
      ["ajt", "src/auth/jwt.ts"],
      ["a/j", "src/auth/jwt.ts"],
      ["f9_3", "file9_3.ts"],
      ["", "anything"],
    ];
    for (const [query, target] of pairs) {
      expect(characterMask(target) & characterMask(query)).toBe(characterMask(query));
    }
  });

  it("rejects queries containing characters the target lacks", () => {
    const target = characterMask("src/auth/jwt.ts");
    for (const query of ["z", "auth1", "q/"]) {
      expect(target & characterMask(query)).not.toBe(characterMask(query));
    }
    // Slash is tracked, so a path query cannot match a bare name.
    expect(characterMask("jwt.ts") & characterMask("a/j")).not.toBe(characterMask("a/j"));
  });
});

describe("isSubsequence", () => {
  it("requires characters in order", () => {
    expect(isSubsequence("ajt", "src/auth/jwt.ts")).toBe(true);
    expect(isSubsequence("tja", "src/auth/jwt.ts")).toBe(false);
    expect(isSubsequence("", "anything")).toBe(true);
  });
});

describe("fuzzyScore", () => {
  it("returns NO_MATCH when the query is not a subsequence", () => {
    expect(score("xyz", "authenticate")).toBe(NO_MATCH);
    expect(score("authenticates", "authenticate")).toBe(NO_MATCH);
  });

  it("is case-insensitive", () => {
    expect(score("AUTH", "authenticate")).not.toBe(NO_MATCH);
    expect(score("auth", "AUTHENTICATE")).not.toBe(NO_MATCH);
  });

  it("prefers consecutive matches over scattered ones", () => {
    expect(score("auth", "authorize")).toBeGreaterThan(score("auth", "a_u_t_h"));
    expect(score("jwt", "jwt.ts")).toBeGreaterThan(score("jwt", "json-web-token.ts"));
  });

  it("rewards word boundaries: separators, delimiters and camelCase humps", () => {
    // "us" at the camelCase hump beats "us" buried in a word.
    expect(score("us", "getUserService")).toBeGreaterThan(score("us", "focusable"));
    expect(score("gus", "getUserService")).toBeGreaterThan(score("gus", "fungusModule"));
    expect(score("fb", "foo_bar")).toBeGreaterThan(score("fb", "fooabar"));
    expect(score("sa", "src/auth")).toBeGreaterThan(score("sa", "srcxauth"));
  });

  it("gives the start of the string the strongest bonus", () => {
    expect(score("a", "auth")).toBeGreaterThan(score("a", "xauth"));
    expect(score("auth", "auth.ts")).toBeGreaterThan(score("auth", "oauth.ts"));
  });

  it("awards a small bonus for exact letter case", () => {
    expect(score("User", "User")).toBeGreaterThan(score("user", "User"));
  });

  it("scores the tail of very long targets", () => {
    const long = `${"x/".repeat(MAX_TARGET_LENGTH)}needle.ts`;
    expect(score("needle", long)).not.toBe(NO_MATCH);
  });

  it("never exceeds maxFuzzyScore", () => {
    const targets = ["Auth", "AUTH", "a/U/t/H", "src/auth/AuthService.ts", "A_B_C_D", "abcd"];
    for (const target of targets) {
      for (const query of ["a", "Au", "AUTH", "abcd", "ABCD", "auth"]) {
        const value = score(query, target);
        if (value !== NO_MATCH)
          expect(value).toBeLessThanOrEqual(maxFuzzyScore(prepareQuery(query).lower.length));
      }
    }
    expect(score("AUTH", "AUTH")).toBe(maxFuzzyScore(4));
  });

  it("agrees with fuzzyMatch on the best score", () => {
    const cases: Array<[string, string]> = [
      ["auth", "src/auth/authService.ts"],
      ["ctrl", "src/controllers/userController.ts"],
      ["idx", "packages/sdk/src/index.ts"],
      ["mw", "src/auth/middleware.ts"],
      ["aaa", "abababab_aaa"],
    ];
    for (const [query, target] of cases) {
      expect(fuzzyMatch(prepareQuery(query), target, target.toLowerCase())?.score).toBe(
        score(query, target),
      );
    }
  });
});

describe("fuzzyMatch", () => {
  it("returns the positions of the best alignment", () => {
    expect(positions("auth", "authenticate")).toEqual([0, 1, 2, 3]);
    expect(positions("as", "AuthService")).toEqual([0, 4]);
    expect(positions("jwt", "src/auth/jwt.ts")).toEqual([9, 10, 11]);
  });

  it("prefers word starts over earlier mid-word occurrences", () => {
    // "st" at the start of the "strings" segment beats "st" inside "list".
    expect(positions("st", "list/strings.ts")).toEqual([5, 6]);
    expect(positions("cs", "checkoutSession")).toEqual([0, 8]);
  });

  it("returns an empty match for an empty query and null for no match", () => {
    expect(fuzzyMatch(prepareQuery(""), "abc", "abc")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch(prepareQuery("zz"), "abc", "abc")).toBeNull();
  });

  it("maps positions correctly on truncated long targets", () => {
    const long = `${"x/".repeat(MAX_TARGET_LENGTH)}needle.ts`;
    const result = positions("needle", long);
    expect(result).toHaveLength(6);
    expect(result?.map((p) => long.charAt(p)).join("")).toBe("needle");
  });
});
