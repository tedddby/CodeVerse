import type { StageEvent } from "@/analysis/protocol";
import type { LanguageStat, RepositoryGraph } from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { formatBytes, formatInteger, formatPercent, pluralize } from "@/lib/utils/format";

/**
 * Short result lines shown next to each stage in the loading experience.
 * Shared by the live pipeline and the replay of cached graphs, so both paths
 * describe a repository with the same words.
 */

export const REPOSITORY_FOUND = "Repository found";
/** Connect result when GitHub could not confirm the current commit and a cached graph is served. */
export const STALE_CONNECT_MESSAGE = "GitHub unavailable · using the cached analysis";
export const CONSTRUCT_COMPLETE = "Complete";

/** "3,281 files", "1 file", "3,281 files · listing truncated". */
export function treeMessage(fileCount: number, truncated: boolean): string {
  const files = pluralize(fileCount, "file");
  return truncated ? `${files} · listing truncated` : files;
}

/**
 * Dominant programming language by bytes with its share of the repository,
 * e.g. "TypeScript 62%". Falls back to the largest recognized language, and
 * to a neutral line when nothing is recognized.
 */
export function languageMessage(languages: readonly LanguageStat[]): string {
  const known = languages.filter((language) => language.id !== "unknown" && language.bytes > 0);
  const source = known.filter((language) => getLanguage(language.id).category === "source");
  const top = source[0] ?? known[0];
  if (!top) return "No recognized languages";
  return `${top.name} ${formatPercent(top.share)}`;
}

/** "412 of 1,500 files". */
export function progressMessage(done: number, total: number): string {
  return `${formatInteger(done)} of ${formatInteger(total)} files`;
}

/** "1,204 files · 8.2 MB". */
export function fetchMessage(files: number, bytes: number): string {
  return `${pluralize(files, "file")} · ${formatBytes(bytes)}`;
}

/** "1,180 files parsed", "1,180 files parsed · 3 failed". */
export function parseMessage(parsed: number, failed: number): string {
  const base = `${pluralize(parsed, "file")} parsed`;
  return failed > 0 ? `${base} · ${formatInteger(failed)} failed` : base;
}

/** "4,812 imports · 1,203 resolved". */
export function dependenciesMessage(found: number, resolved: number): string {
  return `${pluralize(found, "import")} · ${formatInteger(resolved)} resolved`;
}

/** "300 commits · 42 contributors". */
export function historyMessage(commits: number, contributors: number): string {
  const base = pluralize(commits, "commit");
  return contributors > 0 ? `${base} · ${pluralize(contributors, "contributor")}` : base;
}

/**
 * Stage events describing a graph served from cache: every stage reports
 * "done" with a result derived from the graph (the caller emits the
 * "complete" event). A `stale` replay (GitHub could not confirm the current
 * commit) reports the connect stage as a warning.
 */
export function cachedStageEvents(graph: RepositoryGraph, stale = false): StageEvent[] {
  const { coverage, history } = graph.analysis;
  const done = (stage: StageEvent["stage"], message: string): StageEvent => ({
    type: "stage",
    stage,
    status: "done",
    message,
  });
  const parsed = coverage.filesParsed + coverage.filesPartial;
  return [
    stale
      ? { type: "stage", stage: "connect", status: "warning", message: STALE_CONNECT_MESSAGE }
      : done("connect", REPOSITORY_FOUND),
    done("tree", treeMessage(coverage.filesInRepository, graph.analysis.treeTruncated)),
    done("languages", languageMessage(graph.languages)),
    done("fetch", "Cached"),
    done("parse", `${pluralize(parsed, "file")} parsed · cached`),
    done("dependencies", dependenciesMessage(coverage.importsFound, coverage.importsResolved)),
    done(
      "history",
      history.commitsFetched > 0
        ? historyMessage(history.commitsFetched, graph.contributors.length)
        : "No history",
    ),
    done("construct", CONSTRUCT_COMPLETE),
  ];
}
