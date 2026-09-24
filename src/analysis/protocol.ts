import type { RepositoryGraph } from "@/graph/model/types";

/**
 * Wire protocol between `GET /api/analyze/{owner}/{repo}` and the browser.
 *
 * The response is `application/x-ndjson`: one JSON-encoded `AnalysisEvent` per line.
 * The stream always ends with exactly one `complete` or `error` event.
 * This module is shared by server and client and must stay dependency-free.
 */

export const ANALYSIS_STAGES = [
  "connect",
  "tree",
  "languages",
  "fetch",
  "parse",
  "dependencies",
  "history",
  "construct",
] as const;

export type AnalysisStageId = (typeof ANALYSIS_STAGES)[number];

/** User-facing labels, shown in the loading experience. */
export const STAGE_LABELS: Record<AnalysisStageId, string> = {
  connect: "Connecting to GitHub",
  tree: "Fetching file tree",
  languages: "Analyzing languages",
  fetch: "Downloading source",
  parse: "Parsing source",
  dependencies: "Building dependency graph",
  history: "Reading history",
  construct: "Constructing universe",
};

export type StageStatus = "start" | "progress" | "done" | "skipped" | "warning";

export interface StageEvent {
  type: "stage";
  stage: AnalysisStageId;
  status: StageStatus;
  /** 0..1 for "progress" events. */
  progress?: number;
  /** Short result line, e.g. "Repository found", "3,281 files", "TypeScript 62%". */
  message?: string;
}

/** Structure-only graph sent as soon as the tree is known (progressive loading). */
export interface PreviewEvent {
  type: "preview";
  graph: RepositoryGraph;
}

export interface CompleteEvent {
  type: "complete";
  graph: RepositoryGraph;
}

export type AnalysisErrorCode =
  | "INVALID_REPOSITORY"
  | "NOT_FOUND"
  | "PRIVATE_OR_INACCESSIBLE"
  | "RATE_LIMITED"
  | "CLIENT_RATE_LIMITED"
  | "UNAUTHORIZED"
  | "EMPTY_REPOSITORY"
  | "REF_NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INTERNAL";

export interface AnalysisErrorPayload {
  code: AnalysisErrorCode;
  /** Headline, e.g. "Repository not found." */
  title: string;
  /** Explanation / next step. */
  message: string;
  /** ISO date after which retrying makes sense (rate limits). */
  retryAt?: string;
}

export interface ErrorEvent {
  type: "error";
  error: AnalysisErrorPayload;
}

/** Keeps proxies from closing idle connections during long stages. */
export interface HeartbeatEvent {
  type: "heartbeat";
}

export type AnalysisEvent = StageEvent | PreviewEvent | CompleteEvent | ErrorEvent | HeartbeatEvent;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeEvent(event: AnalysisEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** User-facing copy for each error code. The server may override `message` with specifics. */
export const ERROR_COPY: Record<AnalysisErrorCode, { title: string; message: string }> = {
  INVALID_REPOSITORY: {
    title: "That doesn't look like a GitHub repository.",
    message: "Use a URL like https://github.com/facebook/react or the short form facebook/react.",
  },
  NOT_FOUND: {
    title: "Repository not found.",
    message: "This repository may be private or the URL may be incorrect.",
  },
  PRIVATE_OR_INACCESSIBLE: {
    title: "This repository isn't publicly accessible.",
    message: "CodeVerse currently supports public repositories only.",
  },
  RATE_LIMITED: {
    title: "GitHub API rate limit reached.",
    message:
      "Add a GitHub token to continue with higher limits, or try again when the limit resets.",
  },
  CLIENT_RATE_LIMITED: {
    title: "Too many analyses in a short time.",
    message: "Please wait a minute before exploring another repository.",
  },
  UNAUTHORIZED: {
    title: "The configured GitHub token was rejected.",
    message: "Check the GITHUB_TOKEN environment variable on the server.",
  },
  EMPTY_REPOSITORY: {
    title: "This repository is empty.",
    message: "There are no files on the default branch to visualize yet.",
  },
  REF_NOT_FOUND: {
    title: "Branch or commit not found.",
    message: "The requested branch, tag or commit does not exist in this repository.",
  },
  UPSTREAM_ERROR: {
    title: "GitHub is having trouble right now.",
    message: "The GitHub API returned an error. Please try again in a moment.",
  },
  TIMEOUT: {
    title: "The analysis took too long.",
    message: "GitHub responded too slowly. Please try again.",
  },
  NETWORK_ERROR: {
    title: "Couldn't reach the server.",
    message: "Check your connection and try again.",
  },
  INTERNAL: {
    title: "Something went wrong while analyzing this repository.",
    message: "This is a bug in CodeVerse. Please try again or open an issue.",
  },
};
