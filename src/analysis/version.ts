/**
 * Version of the analyzer. It is part of every graph cache key, so bumping it
 * invalidates all cached graphs (do so whenever the pipeline, the graph
 * builders or the parser change what a graph contains). Format: YYYY.MM.patch.
 */
export const ANALYZER_VERSION = "2026.09.2";
