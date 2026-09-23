"use client";

import { useCallback, useEffect, useState } from "react";
import type { SourceFileResponse } from "@/analysis/source-protocol";
import {
  fetchSourceFile,
  SourceRequestAbortedError,
  sourceFileCache,
  viewerError,
  type SourceViewerError,
} from "./source-cache";

export type SourceFileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; file: SourceFileResponse }
  | { status: "error"; error: SourceViewerError };

interface SettledRequest {
  url: string;
  attempt: number;
  state: SourceFileState;
}

/**
 * Loads a file from the source API with abort-on-change and the shared LRU
 * cache. The returned state is derived from the current `url`, so switching
 * files never shows the previous file's content.
 */
export function useSourceFile(url: string | null): { state: SourceFileState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<SettledRequest | null>(null);

  useEffect(() => {
    if (!url || sourceFileCache.has(url)) return;
    const controller = new AbortController();
    fetchSourceFile(url, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSettled({
          url,
          attempt,
          state: result.ok
            ? { status: "ready", file: result.file }
            : { status: "error", error: result.error },
        });
      },
      (error: unknown) => {
        if (error instanceof SourceRequestAbortedError || controller.signal.aborted) return;
        setSettled({ url, attempt, state: { status: "error", error: viewerError("INTERNAL") } });
      },
    );
    return () => controller.abort();
  }, [url, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (!url) return { state: { status: "idle" }, retry };
  const cached = sourceFileCache.peek(url);
  if (cached) return { state: { status: "ready", file: cached }, retry };
  if (settled && settled.url === url && settled.attempt === attempt)
    return { state: settled.state, retry };
  return { state: { status: "loading" }, retry };
}
