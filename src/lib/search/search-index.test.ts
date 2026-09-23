import { describe, expect, it } from "vitest";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { buildFixtureGraph, createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { buildSearchIndex, searchRepository, symbolTitle, type SearchResult } from "./search-index";

const index = buildGraphIndex(mockRepositoryGraph);
const searchIndex = buildSearchIndex(index);

function titles(results: SearchResult[]): string[] {
  return results.map((result) => result.title);
}

describe("buildSearchIndex", () => {
  it("indexes every directory (except the root), file and symbol", () => {
    expect(searchIndex.counts.file).toBe(mockRepositoryGraph.files.length);
    expect(searchIndex.counts.symbol).toBe(mockRepositoryGraph.symbols.length);
    expect(searchIndex.counts.directory).toBe(mockRepositoryGraph.directories.length - 1);
  });

  it("formats titles and subtitles per kind", () => {
    const directory = searchRepository(searchIndex, "payments", { kinds: ["directory"] })[0];
    expect(directory).toMatchObject({ title: "payments/", subtitle: "src/", kind: "directory" });

    const file = searchRepository(searchIndex, "jwt.ts", { kinds: ["file"] })[0];
    expect(file).toMatchObject({ title: "jwt.ts", subtitle: "src/auth/", language: "typescript" });

    const method = searchRepository(searchIndex, "verifyPassword")[0];
    expect(method).toMatchObject({
      kind: "symbol",
      title: "verifyPassword()",
      subtitle: "AuthService · src/auth/auth.ts:264",
      symbolKind: "method",
    });

    const rootFile = searchRepository(searchIndex, "README.md")[0];
    expect(rootFile?.subtitle).toBe(mockRepositoryGraph.repository.name);
  });

  it("titles callables with parentheses only", () => {
    expect(symbolTitle("authenticate", "function")).toBe("authenticate()");
    expect(symbolTitle("run", "method")).toBe("run()");
    expect(symbolTitle("AuthService", "class")).toBe("AuthService");
    expect(symbolTitle("TOKEN_TTL", "constant")).toBe("TOKEN_TTL");
  });
});

describe("searchRepository ranking", () => {
  it("ranks exact name > file stem > prefix > fuzzy name > path-only", () => {
    const results = searchRepository(searchIndex, "auth");
    const order = titles(results);
    // The "auth/" directory is an exact name match.
    expect(order[0]).toBe("auth/");
    // Files whose stem is exactly "auth" come next (shorter path first).
    expect(order.slice(1, 3)).toEqual(["auth.ts", "auth.ts"]);
    expect(results[1]?.subtitle).toBe("src/auth/");
    expect(results[2]?.subtitle).toBe("src/api/handlers/");
    // Prefix matches (auth.test.ts, authenticate(), AuthService) outrank path-only matches.
    const prefixIndex = order.indexOf("authenticate()");
    const pathOnlyIndex = order.indexOf("middleware.ts");
    expect(prefixIndex).toBeGreaterThan(2);
    expect(pathOnlyIndex).toBeGreaterThan(prefixIndex);
    expect(order.indexOf("AuthService")).toBeLessThan(pathOnlyIndex);
  });

  it("ranks basename matches above path-only matches", () => {
    const order = titles(searchRepository(searchIndex, "session"));
    // Stem match, then name prefix, then a fuzzy (mid-name) match.
    expect(order.slice(0, 3)).toEqual(["session.ts", "SessionStore", "createCheckoutSession()"]);

    // "handlers" only matches the path of files inside src/api/handlers/, never their names.
    const handlers = searchRepository(searchIndex, "handlers");
    expect(handlers[0]).toMatchObject({ kind: "directory", title: "handlers/" });
    const pathOnly = handlers.filter((result) => result.kind === "file");
    expect(pathOnly.length).toBeGreaterThan(0);
    expect(pathOnly.every((result) => result.subtitle === "src/api/handlers/")).toBe(true);
    expect(pathOnly.every((result) => result.matches.length === 0)).toBe(true);
  });

  it("matches camelCase humps and word boundaries", () => {
    const results = searchRepository(searchIndex, "ccs", { kinds: ["symbol"] });
    expect(results[0]?.title).toBe("createCheckoutSession()");
    expect(results[0]?.matches).toEqual([0, 6, 14]);

    const humps = searchRepository(searchIndex, "sg", { kinds: ["symbol"] });
    expect(humps[0]?.title).toBe("StripeGateway");
  });

  it("supports path queries with separators", () => {
    const results = searchRepository(searchIndex, "auth/jwt");
    expect(results[0]).toMatchObject({ title: "jwt.ts", subtitle: "src/auth/" });
    // Highlight indices are expressed in title coordinates.
    expect(results[0]?.matches).toEqual([0, 1, 2]);
  });

  it("treats queries case-insensitively and ignores whitespace", () => {
    expect(titles(searchRepository(searchIndex, "USERSERVICE"))[0]).toBe("UserService");
    expect(titles(searchRepository(searchIndex, "user service"))[0]).toBe("UserService");
  });

  it("finds nested symbols by qualified name", () => {
    const results = searchRepository(searchIndex, "AuthService.refresh", { kinds: ["symbol"] });
    expect(results[0]).toMatchObject({ title: "refresh()", matches: [0, 1, 2, 3, 4, 5, 6] });
  });

  it("returns highlight indices that point at matching characters", () => {
    for (const query of ["pay", "chk", "uRepo", "idx", "reg"]) {
      for (const result of searchRepository(searchIndex, query)) {
        for (const position of result.matches) {
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeLessThan(result.title.length);
          expect(query.toLowerCase()).toContain(result.title.charAt(position).toLowerCase());
        }
        const sorted = [...result.matches].sort((a, b) => a - b);
        expect(result.matches).toEqual(sorted);
      }
    }
  });

  it("filters by kind and respects the limit", () => {
    const files = searchRepository(searchIndex, "s", { kinds: ["file"] });
    expect(files.every((result) => result.kind === "file")).toBe(true);
    expect(searchRepository(searchIndex, "s", { limit: 3 })).toHaveLength(3);
    expect(searchRepository(searchIndex, "e").length).toBeLessThanOrEqual(50);
  });

  it("returns results sorted by descending score, deterministically", () => {
    const first = searchRepository(searchIndex, "re");
    const second = searchRepository(searchIndex, "re");
    expect(first).toEqual(second);
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(first[i]?.score ?? 0);
    }
  });

  it("prunes without changing results (bounded top-K equals full ranking)", () => {
    const synthetic = buildSearchIndex(
      buildGraphIndex(createSyntheticGraph({ fileCount: 2_000, seed: 11 })),
    );
    for (const query of ["a", "sym1", "core", "api/f", "file12", "utils"]) {
      const bounded = searchRepository(synthetic, query, { limit: 25 });
      const full = searchRepository(synthetic, query, { limit: 1_000_000 }).slice(0, 25);
      expect(bounded).toEqual(full);
    }
  });

  it("returns no results when nothing matches", () => {
    expect(searchRepository(searchIndex, "qqqzzz")).toEqual([]);
  });

  it("downranks generated files such as lockfiles", () => {
    const results = searchRepository(searchIndex, "pnpm");
    expect(results[0]?.title).toBe("pnpm-lock.yaml");
    const lock = searchRepository(searchIndex, "p", { kinds: ["file"], limit: 50 });
    const lockIndex = lock.findIndex((result) => result.title === "pnpm-lock.yaml");
    const packageIndex = lock.findIndex((result) => result.title === "package.json");
    expect(packageIndex).toBeLessThan(lockIndex);
  });
});

describe("suggestions", () => {
  it("returns the most-connected files and largest directories for an empty query", () => {
    const suggestions = searchRepository(searchIndex, "   ");
    expect(suggestions.length).toBeGreaterThan(0);
    const files = suggestions.filter((result) => result.kind === "file");
    const directories = suggestions.filter((result) => result.kind === "directory");
    expect(files.length).toBeGreaterThan(0);
    expect(directories.length).toBeGreaterThan(0);

    const degree = (id: string) =>
      (index.dependenciesBySource.get(id)?.length ?? 0) +
      (index.dependenciesByTarget.get(id)?.length ?? 0);
    const maxDegree = Math.max(...mockRepositoryGraph.files.map((file) => degree(file.id)));
    expect(degree(files[0]?.ref.id ?? "")).toBe(maxDegree);
    expect(directories[0]?.title).toBe("src/");
    expect(suggestions.every((result) => result.matches.length === 0)).toBe(true);
  });

  it("falls back to the largest files when there are no internal dependencies", () => {
    expect(searchIndex.fileSuggestionBasis).toBe("connections");
    const flat = buildSearchIndex(
      buildGraphIndex(
        buildFixtureGraph({
          owner: "o",
          name: "r",
          referenceDate: "2026-01-01T00:00:00.000Z",
          files: [
            { path: "small.ts", lines: 5 },
            { path: "big.ts", lines: 500 },
            { path: "medium.ts", lines: 50 },
          ],
        }),
      ),
    );
    expect(flat.fileSuggestionBasis).toBe("size");
    expect(searchRepository(flat, "", { kinds: ["file"] }).map((result) => result.title)).toEqual([
      "big.ts",
      "medium.ts",
      "small.ts",
    ]);
  });

  it("respects kind filters", () => {
    const suggestions = searchRepository(searchIndex, "", { kinds: ["directory"] });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((result) => result.kind === "directory")).toBe(true);
    expect(searchRepository(searchIndex, "", { kinds: ["symbol"] })).toEqual([]);
  });
});

describe("performance", () => {
  it("searches 25k files and 60k+ symbols in under 30 ms per query", () => {
    const graph = createSyntheticGraph({ fileCount: 25_000, seed: 3 });
    const graphIndex = buildGraphIndex(graph);
    const buildStart = performance.now();
    const largeIndex = buildSearchIndex(graphIndex);
    // Generous guard against accidental O(n²) work in the (one-off) index build.
    expect(performance.now() - buildStart).toBeLessThan(1_000);
    expect(largeIndex.counts.file).toBe(25_000);
    expect(largeIndex.counts.symbol).toBeGreaterThanOrEqual(60_000);

    const queries = [
      "a",
      "core",
      "sym12",
      "authfile",
      "api/file1",
      "renderutils",
      "zzzz",
      "f9_3",
      "clientstore",
      "s",
    ];
    // Warm up the JIT.
    for (const query of queries) searchRepository(largeIndex, query);

    // Best of several runs per query: scheduler noise (parallel test workers)
    // only ever adds time, so the minimum is the query's real cost.
    const bestTimes = queries.map((query) => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 5; run += 1) {
        const start = performance.now();
        const results = searchRepository(largeIndex, query);
        best = Math.min(best, performance.now() - start);
        expect(results.length).toBeLessThanOrEqual(50);
      }
      return { query, best };
    });
    for (const { query, best } of bestTimes) {
      expect(best, `query "${query}" took ${best.toFixed(1)} ms`).toBeLessThan(30);
    }
  });
});
