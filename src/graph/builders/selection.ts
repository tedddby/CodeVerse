import { parentPath } from "@/graph/model/ids";
import type { AnalysisLimits } from "@/lib/config/limits";
import type { FileInventory, InventoryFile } from "./inventory";
import { CATEGORY_RANK, CATEGORY_RANK_COUNT } from "./priority";
import { compareTuples, directoryDepthOf } from "./sort";

/**
 * Chooses which files become buildings (FileNodes) when a repository has more
 * files than `limits.maxFiles`.
 *
 * Two goals pull in different directions: show the most meaningful files
 * (source before tests before docs before assets, hand-written before
 * generated, shallow before deep) and keep the city's shape faithful to the
 * repository (a huge directory must not starve every other district).
 *
 * The algorithm therefore runs in two phases:
 * 1. Floor — every directory with real (non-generated, non-vendored) files gets
 *    its single most important file, using at most half of the budget. Every
 *    district keeps at least one building.
 * 2. Priority classes — for each class (category rank, then generated files of
 *    each rank), files are taken round-robin across directories (shallower
 *    directories first within a round). A directory with 5,000 source files
 *    therefore cannot crowd out a directory with 20.
 *
 * Omitted files are still counted in directory statistics by the assembler.
 */

interface Candidate {
  file: InventoryFile;
  directory: string;
  /** Priority class: category rank, with generated files pushed after every real file. */
  priorityClass: number;
}

function priorityClassOf(file: InventoryFile): number {
  const rank = CATEGORY_RANK[file.category];
  return file.isGenerated ? CATEGORY_RANK_COUNT + rank : rank;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return compareTuples(
    [a.priorityClass, a.file.depth, a.file.path],
    [b.priorityClass, b.file.depth, b.file.path],
  );
}

/** Depth of a directory path ("" -> 0, "src" -> 1, "src/a" -> 2). */
function directoryDepth(directory: string): number {
  return directory === "" ? 0 : directoryDepthOf(directory) + 1;
}

function compareDirectories(a: string, b: string): number {
  return compareTuples([directoryDepth(a), a], [directoryDepth(b), b]);
}

/** Returns the set of paths that become FileNodes. All files when within `limits.maxFiles`. */
export function selectGraphFiles(inventory: FileInventory, limits: AnalysisLimits): Set<string> {
  const budget = Math.max(0, Math.floor(limits.maxFiles));
  if (inventory.files.length <= budget) return new Set(inventory.files.map((file) => file.path));

  const candidates: Candidate[] = inventory.files
    .map((file) => ({
      file,
      directory: parentPath(file.path),
      priorityClass: priorityClassOf(file),
    }))
    .sort(compareCandidates);

  const selected = new Set<string>();

  // Phase 1: one representative per directory with hand-written files.
  const bestByDirectory = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (!bestByDirectory.has(candidate.directory))
      bestByDirectory.set(candidate.directory, candidate);
  }
  const floorBudget = Math.floor(budget / 2);
  const representatives = [...bestByDirectory.values()]
    .filter((candidate) => !candidate.file.isGenerated && candidate.file.category !== "vendor")
    .sort(compareCandidates);
  for (const candidate of representatives) {
    if (selected.size >= floorBudget) break;
    selected.add(candidate.file.path);
  }

  // Phase 2: round-robin across directories within each priority class.
  const byClass = new Map<number, Map<string, Candidate[]>>();
  for (const candidate of candidates) {
    if (selected.has(candidate.file.path)) continue;
    let directories = byClass.get(candidate.priorityClass);
    if (!directories) {
      directories = new Map();
      byClass.set(candidate.priorityClass, directories);
    }
    const list = directories.get(candidate.directory);
    if (list) list.push(candidate);
    else directories.set(candidate.directory, [candidate]);
  }

  const classes = [...byClass.keys()].sort((a, b) => a - b);
  for (const priorityClass of classes) {
    if (selected.size >= budget) break;
    const directories = byClass.get(priorityClass);
    if (!directories) continue;
    let queues = [...directories.keys()]
      .sort(compareDirectories)
      .map((directory) => directories.get(directory) ?? []);
    let round = 0;
    while (queues.length > 0 && selected.size < budget) {
      const remaining: Candidate[][] = [];
      for (const queue of queues) {
        if (selected.size >= budget) break;
        const candidate = queue[round];
        if (candidate) selected.add(candidate.file.path);
        if (queue.length > round + 1) remaining.push(queue);
      }
      queues = remaining;
      round += 1;
    }
  }

  return selected;
}
