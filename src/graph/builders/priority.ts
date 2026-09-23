import type { FileCategory } from "@/graph/model/types";

/**
 * Shared priority heuristics for choosing which files become buildings and
 * which files get parsed when a repository exceeds the analysis limits.
 */

/** Lower is more important. Groups of equal rank are treated as one priority class. */
export const CATEGORY_RANK: Readonly<Record<FileCategory, number>> = {
  source: 0,
  test: 1,
  config: 2,
  build: 2,
  style: 2,
  markup: 2,
  docs: 3,
  data: 4,
  other: 5,
  asset: 6,
  vendor: 7,
};

/** Number of distinct category ranks (used to offset generated files after every real file). */
export const CATEGORY_RANK_COUNT = 8;

/**
 * Directories whose code supports a project rather than being the project:
 * examples, benchmarks, scripts, docs sites. Parsed after core code.
 */
const AUXILIARY_SEGMENTS: ReadonlySet<string> = new Set([
  "examples",
  "example",
  "samples",
  "sample",
  "demo",
  "demos",
  "benchmarks",
  "benchmark",
  "bench",
  "benches",
  "scripts",
  "script",
  "tools",
  "docs",
  "doc",
  "documentation",
  "website",
  "site",
  "playground",
  "playgrounds",
  "sandbox",
  "contrib",
  "hack",
  ".github",
  ".storybook",
  "stories",
]);

/** Directories that hold many independent packages/crates/apps (monorepo containers). */
const CONTAINER_SEGMENTS: ReadonlySet<string> = new Set([
  "packages",
  "crates",
  "apps",
  "libs",
  "modules",
  "services",
  "plugins",
  "extensions",
  "projects",
  "components",
]);

/** Whether any directory segment of `path` marks auxiliary (non-core) code. */
export function isAuxiliaryPath(path: string): boolean {
  const segments = path.split("/");
  segments.pop();
  return segments.some((segment) => AUXILIARY_SEGMENTS.has(segment));
}

/**
 * Coarse "area" of the repository a file belongs to: its top-level directory,
 * or `container/name` inside monorepo containers ("packages/ui"). Root files
 * share the "" area. Used to spread limited budgets across the codebase.
 */
export function areaOf(path: string): string {
  const segments = path.split("/");
  segments.pop();
  const first = segments[0];
  if (first === undefined) return "";
  const second = segments[1];
  if (second !== undefined && CONTAINER_SEGMENTS.has(first)) return `${first}/${second}`;
  return first;
}

/**
 * Round-robin interleaving of pre-ordered groups: takes the first item of every
 * group (in group order), then the second, and so on. Stable and deterministic.
 */
export function interleave<T>(groups: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const result: T[] = [];
  let round = 0;
  let active = groups.filter((group) => group.length > 0);
  while (active.length > 0) {
    const next: Array<ReadonlyArray<T>> = [];
    for (const group of active) {
      const item = group[round];
      if (item !== undefined) result.push(item);
      if (group.length > round + 1) next.push(group);
    }
    active = next;
    round += 1;
  }
  return result;
}
