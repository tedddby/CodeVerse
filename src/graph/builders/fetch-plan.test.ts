import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, type AnalysisLimits } from "@/lib/config/limits";
import type { AnalysisTier } from "@/graph/model/types";
import type { SourceTreeEntry } from "@/sources/types";
import { buildInventory, planContentFetch, type FetchPlan, type FileInventory } from "./inventory";

const KB = 1024;
const entry = (path: string, size = 2 * KB): SourceTreeEntry => ({ path, type: "file", size });
const range = (count: number, make: (index: number) => SourceTreeEntry): SourceTreeEntry[] =>
  Array.from({ length: count }, (_, index) => make(index));

function plan(
  entries: SourceTreeEntry[],
  tier: AnalysisTier,
  limits: Partial<AnalysisLimits> = {},
  graph?: (path: string) => boolean,
): { inventory: FileInventory; graphFiles: Set<string>; result: FetchPlan } {
  const inventory = buildInventory({ entries, truncated: false });
  const graphFiles = new Set(
    inventory.files.map((file) => file.path).filter((path) => (graph ? graph(path) : true)),
  );
  return {
    inventory,
    graphFiles,
    result: planContentFetch(inventory, graphFiles, tier, { ...DEFAULT_LIMITS, ...limits }),
  };
}

function expectPartition(graphFiles: ReadonlySet<string>, result: FetchPlan): void {
  const seen = new Map<string, number>();
  for (const path of [...result.parseFiles, ...result.contentOnlyFiles, ...result.skipped.keys()]) {
    seen.set(path, (seen.get(path) ?? 0) + 1);
  }
  expect([...seen.keys()].sort()).toEqual([...graphFiles].sort());
  expect([...seen.values()].every((count) => count === 1)).toBe(true);
}

describe("planContentFetch", () => {
  const repository = [
    entry("package.json", 1 * KB),
    entry("tsconfig.json", 1 * KB),
    entry("packages/ui/package.json", 1 * KB),
    entry("node_modules/react/package.json", 1 * KB),
    entry("huge/package.json", 300 * KB),
    entry("src/index.ts", 3 * KB),
    entry("src/app/main.ts", 3 * KB),
    entry("src/big.ts", 300 * KB),
    entry("src/enormous.ts", 900 * KB),
    entry("src/types.pb.go", 5 * KB),
    entry("src/app.test.ts", 2 * KB),
    entry("examples/demo.ts", 2 * KB),
    entry("README.md", 4 * KB),
    entry("docs/huge.md", 100 * KB),
    entry("logo.png", 40 * KB),
    entry("setup.py", 1 * KB),
  ];

  it("partitions every graph file into parse, content-only or skipped", () => {
    const { graphFiles, result } = plan(repository, "full");
    expectPartition(graphFiles, result);
  });

  it("assigns precise skip reasons", () => {
    const { result } = plan(repository, "full");
    expect(result.skipped.get("logo.png")).toBe("binary");
    expect(result.skipped.get("src/types.pb.go")).toBe("generated");
    expect(result.skipped.get("node_modules/react/package.json")).toBe("generated");
    expect(result.skipped.get("src/enormous.ts")).toBe("size-limit");
    expect(result.skipped.get("docs/huge.md")).toBe("not-parseable");
    expect(result.skipped.get("huge/package.json")).toBe("not-parseable");
  });

  it("downloads resolution configs (not vendored, <= 256 KB), shallowest first", () => {
    const { result } = plan(repository, "full");
    expect(result.configFiles).toEqual([
      "package.json",
      "setup.py",
      "tsconfig.json",
      "packages/ui/package.json",
    ]);
  });

  it("downloads configs even when they are not graph files, and analyses graph configs for free", () => {
    const { result } = plan(
      repository,
      "directory-first",
      {},
      (path) => path !== "packages/ui/package.json",
    );
    expect(result.configFiles).toContain("packages/ui/package.json");
    expect(result.contentOnlyFiles).toEqual(["package.json", "tsconfig.json"]);
    expect(result.parseFiles[0]).toBe("setup.py");
    expect(result.skipped.get("README.md")).toBe("not-selected");
  });

  it("orders parsing: config, core source (shallow first), auxiliary code, then tests", () => {
    const { result } = plan(repository, "full");
    expect(result.parseFiles).toEqual([
      "setup.py",
      "src/index.ts",
      "src/app/main.ts",
      "examples/demo.ts",
      "src/app.test.ts",
    ]);
    expect(result.eligibleParseFiles).toBe(5);
  });

  it("line-counts oversized source and small text files in the full tier", () => {
    const { result } = plan(repository, "full");
    expect(result.contentOnlyFiles).toEqual([
      "package.json",
      "tsconfig.json",
      "packages/ui/package.json",
      "src/big.ts",
      "README.md",
    ]);
  });

  it("caps parsing per tier and reports the rest as parse-limit", () => {
    const sources = range(700, (i) => entry(`src/m${String(i).padStart(3, "0")}.ts`));
    const directoryFirst = plan(sources, "directory-first", { maxParsedFiles: 1_500 }).result;
    expect(directoryFirst.parseFiles).toHaveLength(500);
    expect(directoryFirst.eligibleParseFiles).toBe(700);
    expect(
      [...directoryFirst.skipped.values()].filter((reason) => reason === "parse-limit"),
    ).toHaveLength(200);

    const progressive = plan(sources, "progressive", { maxParsedFiles: 650 }).result;
    expect(progressive.parseFiles).toHaveLength(650);
  });

  it("interleaves monorepo packages so a limited budget covers all of them", () => {
    const sources = [
      ...range(100, (i) => entry(`packages/alpha/src/a${String(i).padStart(3, "0")}.ts`)),
      ...range(100, (i) => entry(`packages/beta/src/b${String(i).padStart(3, "0")}.ts`)),
      ...range(100, (i) => entry(`packages/gamma/src/c${String(i).padStart(3, "0")}.ts`)),
    ];
    const { result } = plan(sources, "progressive", { maxParsedFiles: 30 });
    const count = (name: string) =>
      result.parseFiles.filter((path) => path.startsWith(`packages/${name}/`)).length;
    expect([count("alpha"), count("beta"), count("gamma")]).toEqual([10, 10, 10]);
  });

  it("limits content-only downloads by tier", () => {
    const docs = range(400, (i) => entry(`docs/p${String(i).padStart(3, "0")}.md`));
    expect(plan(docs, "full").result.contentOnlyFiles).toHaveLength(400);
    const progressive = plan(docs, "progressive").result;
    expect(progressive.contentOnlyFiles).toHaveLength(300);
    expect(
      [...progressive.skipped.values()].filter((reason) => reason === "not-selected"),
    ).toHaveLength(100);
    expect(plan(docs, "directory-first").result.contentOnlyFiles).toHaveLength(0);
  });

  it("never plans more than maxTotalBytes (configs first, then parse, then content-only)", () => {
    const entries = [
      entry("package.json", 10 * KB),
      ...range(20, (i) => entry(`src/f${String(i).padStart(2, "0")}.ts`, 50 * KB)),
      ...range(10, (i) => entry(`docs/d${i}.md`, 30 * KB)),
    ];
    const maxTotalBytes = 400 * KB;
    const { inventory, graphFiles, result } = plan(entries, "full", { maxTotalBytes });
    expectPartition(graphFiles, result);
    const sizes = new Map(inventory.files.map((file) => [file.path, file.size] as const));
    const planned = new Set([
      ...result.configFiles,
      ...result.parseFiles,
      ...result.contentOnlyFiles,
    ]);
    const bytes = [...planned].reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
    expect(bytes).toBeLessThanOrEqual(maxTotalBytes);
    expect(result.configFiles).toEqual(["package.json"]);
    expect(result.parseFiles).toHaveLength(7);
    expect(
      [...result.skipped.values()].filter((reason) => reason === "byte-budget").length,
    ).toBeGreaterThan(0);
  });

  it("is deterministic regardless of tree order", () => {
    const first = plan(repository, "progressive").result;
    const second = plan([...repository].reverse(), "progressive").result;
    expect(JSON.stringify({ ...second, skipped: [...second.skipped] })).toBe(
      JSON.stringify({ ...first, skipped: [...first.skipped] }),
    );
  });
});
