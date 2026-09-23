import { createHash } from "node:crypto";
import type { RepositoryInfo } from "@/graph/model/types";
import { snapshotLimits, type AnalysisLimits } from "@/lib/config/limits";
import type { SourceCapabilities } from "@/sources/types";
import { ANALYZER_VERSION } from "./version";

/**
 * Cache keys for analysed graphs.
 *
 *   graph:   `${ANALYZER_VERSION}:${repository.id}@${commitSha}:${limitsHash}`
 *   latest:  `${ANALYZER_VERSION}:latest:${lower-case repository.id}`
 *
 * The limits hash covers every setting that changes the graph for the same
 * commit: the limits snapshot, plus the provider capabilities (a server that
 * gains a token produces richer history, so it must not reuse graphs built
 * without one).
 */

function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
}

/** Short, stable digest of the analysis settings. */
export function limitsHash(limits: AnalysisLimits, capabilities?: SourceCapabilities): string {
  const settings = stableStringify({
    ...snapshotLimits(limits),
    fileHistory: capabilities?.fileHistory ?? false,
    commitCounts: capabilities?.commitCounts ?? false,
  });
  return createHash("sha256").update(settings, "utf8").digest("hex").slice(0, 16);
}

export function graphCacheKey(
  repository: Pick<RepositoryInfo, "id" | "commitSha">,
  limits: AnalysisLimits,
  capabilities?: SourceCapabilities,
): string {
  return `${ANALYZER_VERSION}:${repository.id}@${repository.commitSha.toLowerCase()}:${limitsHash(limits, capabilities)}`;
}

/** Key of the pointer to the most recent graph of a repository (case-insensitive). */
export function latestGraphPointerKey(repositoryId: string): string {
  return `${ANALYZER_VERSION}:latest:${repositoryId.toLowerCase()}`;
}
