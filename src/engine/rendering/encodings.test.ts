import { buildGraphIndex, type GraphIndex } from "@/graph/model/graph-index";
import { contributorIdFromLogin, directoryId, fileId } from "@/graph/model/ids";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { getLanguageColor } from "@/lib/languages/registry";
import {
  BUILDING_FLAGS,
  DIMMED_EMPHASIS,
  OUT_OF_FOCUS_EMPHASIS,
  buildingFlags,
  complexityScore,
  computeBuildingVisuals,
  filesActiveInWindow,
  rankTopContributors,
  recencyScore,
  type EncodingContext,
} from "./encodings";
import { SCENE_HEX, hexToLinear } from "./palette";

const REFERENCE = Date.parse("2026-09-01T00:00:00.000Z");
const DAY = 86_400_000;

const index = buildGraphIndex(mockRepositoryGraph);
const ids = mockRepositoryGraph.files.map((f) => f.id);

function ctx(
  patch: Partial<EncodingContext> = {},
  graphIndex: GraphIndex = index,
): EncodingContext {
  return {
    index: graphIndex,
    visualMode: "architecture",
    selection: null,
    hovered: null,
    focusedDirectoryId: null,
    activeContributorId: null,
    timeline: { active: false, cursor: null, windowDays: 30 },
    showDependencies: false,
    now: REFERENCE,
    ...patch,
  };
}

function visualsFor(path: string, context: EncodingContext, buildingIds: readonly string[] = ids) {
  const visuals = computeBuildingVisuals(buildingIds, context);
  const i = buildingIds.indexOf(fileId(path));
  if (i === -1) throw new Error(`missing ${path}`);
  return {
    color: [
      visuals.colors[i * 3],
      visuals.colors[i * 3 + 1],
      visuals.colors[i * 3 + 2],
    ] as number[],
    emphasis: visuals.emphasis[i] ?? Number.NaN,
    glow: visuals.glow[i] ?? Number.NaN,
  };
}

function expectColor(actual: number[], hex: string) {
  const expected = hexToLinear(hex);
  expected.forEach((channel, i) => expect(actual[i]).toBeCloseTo(channel, 4));
}

describe("computeBuildingVisuals", () => {
  it("returns one bounded, finite entry per building for every mode", () => {
    for (const visualMode of [
      "architecture",
      "dependencies",
      "activity",
      "contributors",
      "complexity",
    ] as const) {
      const visuals = computeBuildingVisuals(ids, ctx({ visualMode }));
      expect(visuals.colors).toHaveLength(ids.length * 3);
      expect(visuals.emphasis).toHaveLength(ids.length);
      expect(visuals.glow).toHaveLength(ids.length);
      for (const value of visuals.colors) expect(Number.isFinite(value) && value >= 0).toBe(true);
      for (const value of visuals.emphasis) expect(value >= 0 && value <= 1).toBe(true);
      for (const value of visuals.glow) expect(value >= 0 && value <= 1).toBe(true);
    }
  });

  it("is deterministic", () => {
    const a = computeBuildingVisuals(ids, ctx({ visualMode: "complexity" }));
    const b = computeBuildingVisuals(ids, ctx({ visualMode: "complexity" }));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.emphasis)).toEqual(Array.from(b.emphasis));
  });

  it("renders unknown ids as dim neutral buildings", () => {
    const visuals = computeBuildingVisuals(["file:does/not/exist.ts"], ctx());
    expect(visuals.emphasis[0]).toBeLessThan(0.5);
    expect(visuals.glow[0]).toBe(0);
  });

  describe("architecture mode", () => {
    it("colors source files with their language color at full emphasis", () => {
      const auth = visualsFor("src/auth/auth.ts", ctx());
      expectColor(auth.color, getLanguageColor("typescript"));
      expect(auth.emphasis).toBe(1);
      expect(auth.glow).toBe(0);
    });

    it("slightly desaturates tests and docs and dims generated files", () => {
      const source = visualsFor("src/auth/auth.ts", ctx());
      const test = visualsFor("tests/auth.test.ts", ctx());
      const lockfile = visualsFor("pnpm-lock.yaml", ctx());
      expect(test.color).not.toEqual(source.color);
      expect(test.emphasis).toBeLessThan(1);
      expect(test.emphasis).toBeGreaterThan(0.7);
      expect(lockfile.emphasis).toBeLessThan(0.5);
    });

    it("renders binary files as grey slabs", () => {
      const chroma = ([r = 0, g = 0, b = 0]: number[]) => Math.max(r, g, b) - Math.min(r, g, b);
      const png = visualsFor("docs/diagrams/overview.png", ctx());
      const source = visualsFor("src/auth/auth.ts", ctx());
      expect(chroma(png.color)).toBeLessThan(chroma(source.color) * 0.25);
      expect(Math.max(...png.color)).toBeLessThan(0.15);
    });
  });

  describe("dependencies mode", () => {
    it("brightens files with dependencies when nothing is selected", () => {
      const context = ctx({ visualMode: "dependencies" });
      const hub = visualsFor("src/auth/auth.ts", context);
      const isolated = visualsFor("README.md", context);
      expect(hub.emphasis).toBeGreaterThan(0.55);
      expect(isolated.emphasis).toBeCloseTo(0.3, 5);
    });

    it("tints imports cyan, dependents violet and dims the rest for a selected file", () => {
      const context = ctx({
        visualMode: "dependencies",
        selection: { kind: "file", id: fileId("src/auth/auth.ts") },
      });
      const selected = visualsFor("src/auth/auth.ts", context);
      expect(selected.emphasis).toBe(1);

      for (const imported of [
        "src/auth/jwt.ts",
        "src/users/user.ts",
        "src/lib/logger.ts",
        "src/auth/session.ts",
      ]) {
        const v = visualsFor(imported, context);
        expectColor(v.color, SCENE_HEX.signal);
        expect(v.emphasis).toBe(1);
      }
      for (const dependent of [
        "src/auth/middleware.ts",
        "src/api/handlers/auth.ts",
        "tests/auth.test.ts",
      ]) {
        const v = visualsFor(dependent, context);
        expectColor(v.color, SCENE_HEX.ion);
      }
      expect(visualsFor("services/billing/main.go", context).emphasis).toBeCloseTo(
        DIMMED_EMPHASIS,
        5,
      );
    });

    it("marks files related in both directions distinctly", () => {
      const graph = buildFixtureGraph({
        owner: "o",
        name: "cycle",
        referenceDate: "2026-01-01T00:00:00.000Z",
        files: [
          { path: "a.ts", lines: 10, imports: ["b.ts"] },
          { path: "b.ts", lines: 10, imports: ["a.ts"] },
          { path: "c.ts", lines: 10, imports: ["a.ts"] },
        ],
      });
      const cycleIndex = buildGraphIndex(graph);
      const cycleIds = graph.files.map((f) => f.id);
      const context = ctx(
        { visualMode: "dependencies", selection: { kind: "file", id: fileId("a.ts") } },
        cycleIndex,
      );
      const mutual = visualsFor("b.ts", context, cycleIds);
      const dependent = visualsFor("c.ts", context, cycleIds);
      expect(mutual.color).not.toEqual(dependent.color);
      expectColor(dependent.color, SCENE_HEX.ion);
    });

    it("treats a selected directory as a group and colors its external relations", () => {
      const context = ctx({
        visualMode: "dependencies",
        selection: { kind: "directory", id: directoryId("src/payments") },
      });
      expect(visualsFor("src/payments/stripe.ts", context).emphasis).toBe(1);
      expectColor(visualsFor("src/lib/logger.ts", context).color, SCENE_HEX.signal);
      expectColor(visualsFor("src/api/handlers/payments.ts", context).color, SCENE_HEX.ion);
      // Relations inside the group are not tinted as external.
      expectColor(
        visualsFor("src/payments/types.ts", context).color,
        getLanguageColor("typescript"),
      );
    });

    it("uses a symbol selection's file as the subject", () => {
      const symbol = mockRepositoryGraph.symbols.find((s) => s.name === "signToken");
      if (!symbol) throw new Error("fixture symbol missing");
      const context = ctx({
        visualMode: "dependencies",
        selection: { kind: "symbol", id: symbol.id },
      });
      expectColor(visualsFor("src/users/user.ts", context).color, SCENE_HEX.signal);
    });
  });

  describe("activity mode", () => {
    it("heats recently modified files and leaves unknown activity neutral and dim", () => {
      const context = ctx({ visualMode: "activity" });
      const recent = visualsFor("src/auth/jwt.ts", context);
      const old = visualsFor("src/lib/config.ts", context);
      const unknown = visualsFor(".gitignore", context);
      expect(recent.emphasis).toBeGreaterThan(old.emphasis);
      expect(unknown.emphasis).toBeLessThan(old.emphasis);
    });

    it("highlights only files active inside the timeline window", () => {
      const context = ctx({
        visualMode: "activity",
        timeline: { active: true, cursor: REFERENCE - 3 * DAY, windowDays: 5 },
      });
      const inWindow = visualsFor("src/payments/stripe.ts", context);
      const afterCursor = visualsFor("src/auth/jwt.ts", context);
      const before = visualsFor("src/lib/config.ts", context);
      expect(inWindow.emphasis).toBe(1);
      expect(inWindow.glow).toBeGreaterThan(0);
      expect(afterCursor.emphasis).toBeCloseTo(DIMMED_EMPHASIS, 5);
      expect(before.emphasis).toBeCloseTo(DIMMED_EMPHASIS, 5);
    });

    it("ignores the timeline window while the timeline is inactive", () => {
      const context = ctx({
        visualMode: "activity",
        timeline: { active: false, cursor: REFERENCE - 3 * DAY, windowDays: 5 },
      });
      expect(visualsFor("src/auth/jwt.ts", context).emphasis).toBeGreaterThan(DIMMED_EMPHASIS);
    });
  });

  describe("contributors mode", () => {
    const bruno = contributorIdFromLogin("octo-bruno");

    it("brightens files touched by the active contributor and dims the rest", () => {
      const context = ctx({ visualMode: "contributors", activeContributorId: bruno });
      for (const path of [
        "src/payments/stripe.ts",
        "src/payments/checkout.ts",
        "packages/sdk/src/client.ts",
      ]) {
        expect(visualsFor(path, context).emphasis).toBe(1);
      }
      expect(visualsFor("src/auth/jwt.ts", context).emphasis).toBeCloseTo(DIMMED_EMPHASIS, 5);
    });

    it("colors by last author with a categorical palette when no contributor is active", () => {
      const context = ctx({ visualMode: "contributors" });
      const byAda = visualsFor("src/auth/jwt.ts", context);
      const byBruno = visualsFor("src/payments/stripe.ts", context);
      const unknown = visualsFor(".gitignore", context);
      expect(byAda.color).not.toEqual(byBruno.color);
      expect(unknown.emphasis).toBeLessThan(byAda.emphasis);
    });

    it("falls back to the palette view for an unknown contributor id", () => {
      const context = ctx({ visualMode: "contributors", activeContributorId: "user:nobody" });
      expect(visualsFor("src/auth/jwt.ts", context).emphasis).toBeGreaterThan(DIMMED_EMPHASIS);
    });
  });

  describe("complexity mode", () => {
    it("ramps with structural complexity", () => {
      const context = ctx({ visualMode: "complexity" });
      const big = visualsFor("src/auth/auth.ts", context);
      const small = visualsFor("src/lib/config.ts", context);
      expect(big.emphasis).toBeGreaterThan(small.emphasis);
      expect(big.color).not.toEqual(small.color);
    });
  });

  describe("state layers", () => {
    it("dims everything outside the focused directory", () => {
      const context = ctx({ focusedDirectoryId: directoryId("src/auth") });
      expect(visualsFor("src/auth/jwt.ts", context).emphasis).toBe(1);
      expect(visualsFor("src/lib/db.ts", context).emphasis).toBeLessThanOrEqual(
        OUT_OF_FOCUS_EMPHASIS + 1e-6,
      );
      expect(visualsFor("README.md", context).glow).toBe(0);
    });

    it("keeps the selection fully emphasized and glowing, even outside focus", () => {
      const context = ctx({
        focusedDirectoryId: directoryId("src/auth"),
        selection: { kind: "file", id: fileId("src/lib/db.ts") },
      });
      const selected = visualsFor("src/lib/db.ts", context);
      expect(selected.emphasis).toBe(1);
      expect(selected.glow).toBeGreaterThanOrEqual(0.3);
    });

    it("subtly brightens the hovered building", () => {
      const base = visualsFor("src/lib/db.ts", ctx({ visualMode: "complexity" }));
      const hovered = visualsFor(
        "src/lib/db.ts",
        ctx({ visualMode: "complexity", hovered: { kind: "file", id: fileId("src/lib/db.ts") } }),
      );
      expect(hovered.glow).toBeGreaterThan(base.glow);
      expect(hovered.emphasis).toBeGreaterThanOrEqual(base.emphasis);
    });

    it("hints dependency endpoints when lines are shown outside dependencies mode", () => {
      const selection = { kind: "file" as const, id: fileId("src/auth/auth.ts") };
      const without = visualsFor("src/auth/jwt.ts", ctx({ selection }));
      const withLines = visualsFor("src/auth/jwt.ts", ctx({ selection, showDependencies: true }));
      expect(withLines.glow).toBeGreaterThan(without.glow);
    });
  });
});

describe("recencyScore", () => {
  it("orders files by last modification and stays in 0..1", () => {
    const context = ctx();
    const file = (path: string) => {
      const f = index.filesByPath.get(path);
      if (!f) throw new Error(path);
      return f;
    };
    const recent = recencyScore(file("src/auth/jwt.ts"), context);
    const older = recencyScore(file("src/payments/stripe.ts"), context);
    const oldest = recencyScore(file("src/auth/middleware.ts"), context);
    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(oldest);
    for (const value of [recent, older, oldest]) expect(value >= 0 && value <= 1).toBe(true);
    expect(recencyScore(file(".gitignore"), context)).toBe(0);
  });

  it("reads cooler when the whole repository is long dormant", () => {
    const f = index.filesByPath.get("src/auth/jwt.ts");
    if (!f) throw new Error("missing");
    const fresh = recencyScore(f, ctx({ now: REFERENCE }));
    const dormant = recencyScore(f, ctx({ now: REFERENCE + 5 * 365 * DAY }));
    expect(dormant).toBeLessThan(fresh);
  });
});

describe("complexityScore", () => {
  it("is 0 for binaries and bounded for everything else", () => {
    for (const file of mockRepositoryGraph.files) {
      const score = complexityScore(file, index);
      expect(score >= 0 && score <= 1).toBe(true);
      if (file.status === "binary") expect(score).toBe(0);
    }
  });

  it("scores unparsed files on size alone instead of penalizing unknown structure", () => {
    const graph = buildFixtureGraph({
      owner: "o",
      name: "honest",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "big.ts", lines: 1000, status: "metadata-only" },
        { path: "parsed.ts", lines: 1000 },
      ],
    });
    const honestIndex = buildGraphIndex(graph);
    const metadataOnly = honestIndex.filesByPath.get("big.ts");
    const parsed = honestIndex.filesByPath.get("parsed.ts");
    if (!metadataOnly || !parsed) throw new Error("missing");
    expect(complexityScore(metadataOnly, honestIndex)).toBeCloseTo(1, 5);
    expect(complexityScore(parsed, honestIndex)).toBeLessThan(1);
  });
});

describe("buildingFlags", () => {
  it("flags estimated, binary and generated files", () => {
    const flagsOf = (path: string) => buildingFlags(index.filesByPath.get(path));
    expect(flagsOf("docs/diagrams/overview.png") & BUILDING_FLAGS.binary).toBeTruthy();
    expect(flagsOf("pnpm-lock.yaml") & BUILDING_FLAGS.generated).toBeTruthy();
    expect(flagsOf("src/auth/auth.ts")).toBe(0);
    expect(buildingFlags(undefined) & BUILDING_FLAGS.estimated).toBeTruthy();

    const graph = buildFixtureGraph({
      owner: "o",
      name: "m",
      referenceDate: "2026-01-01T00:00:00.000Z",
      files: [{ path: "a.ts", lines: 50, status: "metadata-only" }],
    });
    expect(buildingFlags(graph.files[0]) & BUILDING_FLAGS.estimated).toBeTruthy();
  });
});

describe("rankTopContributors", () => {
  it("ranks by commits in the window, then all-time contributions", () => {
    expect(rankTopContributors(index)).toEqual(
      ["octo-ada", "octo-bruno", "octo-chen", "octo-dara"].map(contributorIdFromLogin),
    );
  });
});

describe("filesActiveInWindow", () => {
  it("collects commit and last-modified activity inside the window only", () => {
    const active = filesActiveInWindow(index, REFERENCE - 3 * DAY, 5);
    expect(active.has(fileId("src/payments/stripe.ts"))).toBe(true);
    expect(active.has(fileId("src/auth/jwt.ts"))).toBe(false);
    expect(active.has(fileId("src/lib/config.ts"))).toBe(false);
  });
});
