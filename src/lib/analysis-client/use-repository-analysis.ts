"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { AnalysisErrorPayload } from "@/analysis/protocol";
import { analyzeApiUrl } from "@/analysis/source-protocol";
import { useExplorerStore } from "@/state/explorer-store";
import {
  analysisReducer,
  createInitialSnapshot,
  type AnalysisAction,
  type AnalysisSnapshot,
} from "./analysis-state";
import { errorFromHttpStatus, errorPayload, extractErrorPayload, parseRetryAfter } from "./events";
import { readNdjson } from "./stream";

/**
 * Streams a real repository analysis from `GET /api/analyze/{owner}/{repo}`
 * and exposes its progress as React state.
 *
 * - The structure-only preview graph and the final graph are loaded into the
 *   explorer store as they arrive (the preview renders dimmed behind the
 *   loading screen while parsing continues).
 * - The request is aborted on unmount and whenever owner/repo/ref change.
 * - Every failure mode ends in `status: "error"` with a user-facing payload:
 *   network failures, HTTP errors (with or without an error body), error
 *   events and streams that end without a terminal event.
 */

export type { AnalysisStatus, StageProgress } from "./analysis-state";

export interface RepositoryAnalysisInput {
  owner: string;
  repo: string;
  /** Branch, tag or commit to analyse; the default branch when omitted. */
  ref?: string;
}

export interface AnalysisState extends AnalysisSnapshot {
  /** Starts a fresh analysis request (e.g. from the error screen). */
  retry: () => void;
}

/** How often the elapsed-time counter advances while the analysis runs. */
const TICK_INTERVAL_MS = 100;

const INITIAL_SNAPSHOT: AnalysisSnapshot = createInitialSnapshot();

/** Copy for a stream that stopped before reporting completion or an error. */
export const STREAM_INTERRUPTED_ERROR: AnalysisErrorPayload = errorPayload("NETWORK_ERROR", {
  title: "The connection was interrupted.",
  message: "The analysis stream ended before the universe was ready. Please try again.",
});

interface KeyedSnapshot {
  key: string;
  snapshot: AnalysisSnapshot;
}

type KeyedAction = AnalysisAction & { key: string };

function keyedReducer(state: KeyedSnapshot, action: KeyedAction): KeyedSnapshot {
  // An action for a new request starts from a clean slate.
  const base = state.key === action.key ? state.snapshot : createInitialSnapshot();
  const snapshot = analysisReducer(base, action);
  if (state.key === action.key && snapshot === state.snapshot) return state;
  return { key: action.key, snapshot };
}

async function readHttpError(response: Response): Promise<AnalysisErrorPayload> {
  const retryAfter = response.headers.get("retry-after");
  let payload: AnalysisErrorPayload | null = null;
  try {
    payload = extractErrorPayload(await response.text());
  } catch {
    // Body unreadable; fall back to the status code.
  }
  if (!payload) return errorFromHttpStatus(response.status, retryAfter);
  if (!payload.retryAt) {
    const retryAt = parseRetryAfter(retryAfter);
    if (retryAt) payload.retryAt = retryAt;
  }
  return payload;
}

interface RunOptions {
  url: string;
  signal: AbortSignal;
  elapsed: () => number;
  send: (action: AnalysisAction) => void;
}

async function runAnalysis({ url, signal, elapsed, send }: RunOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/x-ndjson" }, cache: "no-store" });
  } catch {
    if (!signal.aborted) send({ type: "fail", error: errorPayload("NETWORK_ERROR"), at: elapsed() });
    return;
  }
  if (signal.aborted) return;

  if (!response.ok) {
    const error = await readHttpError(response);
    if (!signal.aborted) send({ type: "fail", error, at: elapsed() });
    return;
  }

  try {
    for await (const event of readNdjson(response, signal)) {
      if (signal.aborted) return;
      if (event.type === "preview" || event.type === "complete") {
        useExplorerStore.getState().loadGraph(event.graph);
      }
      send({ type: "event", event, at: elapsed() });
      if (event.type === "complete" || event.type === "error") return;
    }
  } catch {
    if (!signal.aborted) send({ type: "fail", error: STREAM_INTERRUPTED_ERROR, at: elapsed() });
    return;
  }
  if (!signal.aborted) send({ type: "fail", error: STREAM_INTERRUPTED_ERROR, at: elapsed() });
}

export function useRepositoryAnalysis({ owner, repo, ref }: RepositoryAnalysisInput): AnalysisState {
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([owner, repo, ref ?? null, attempt]);
  const [state, dispatch] = useReducer(keyedReducer, { key: requestKey, snapshot: INITIAL_SNAPSHOT });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const send = (action: AnalysisAction) => {
      if (!signal.aborted) dispatch({ ...action, key: requestKey });
    };

    const timer = window.setInterval(() => send({ type: "tick", at: elapsed() }), TICK_INTERVAL_MS);
    void runAnalysis({ url: analyzeApiUrl(owner, repo, ref), signal, elapsed, send }).finally(() => {
      window.clearInterval(timer);
    });

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [owner, repo, ref, requestKey]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // Until the first action of a new request arrives, show a fresh loading state.
  const snapshot = state.key === requestKey ? state.snapshot : INITIAL_SNAPSHOT;

  return useMemo(() => ({ ...snapshot, retry }), [snapshot, retry]);
}
