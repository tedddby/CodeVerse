"use client";

import { useEffect, useState } from "react";
import type { HighlightedLine, HighlighterLoader } from "./highlighter";
import type { ShikiLanguageId } from "./language-map";

export type HighlightStatus =
  /** No grammar for this language (or loading it failed): plain text. */
  | "plain"
  /** Grammar/highlighter loading. */
  | "loading"
  /** Tokenizing progressively; `tokens` covers the first `tokens.length` lines. */
  | "highlighting"
  | "done";

export interface HighlightState {
  status: HighlightStatus;
  tokens: readonly HighlightedLine[];
  /** Number of lines that will be highlighted in total (capped). */
  target: number;
}

interface StoredHighlight extends HighlightState {
  source: readonly string[];
  language: ShikiLanguageId | null;
}

/** Budget per main-thread slice; keeps interaction responsive while highlighting. */
const SLICE_BUDGET_MS = 12;
const INITIAL_BATCH = 64;
const MAX_BATCH = 1_024;

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Highlights `lines` progressively: tokenizes adaptive batches within a ~12 ms
 * budget, publishes the tokens so far, then yields to the event loop. Stops at
 * `maxLines`. Cancelled automatically when the inputs change or on unmount.
 */
export function useHighlightedLines(
  lines: readonly string[] | null,
  language: ShikiLanguageId | null,
  loadHighlighter: HighlighterLoader,
  maxLines: number,
): HighlightState {
  const [stored, setStored] = useState<StoredHighlight | null>(null);
  const target = lines ? Math.min(lines.length, maxLines) : 0;

  useEffect(() => {
    if (!lines || !language || target === 0) return;
    let cancelled = false;
    const publish = (status: HighlightStatus, tokens: readonly HighlightedLine[]) => {
      if (!cancelled) setStored({ source: lines, language, status, tokens, target });
    };

    const run = async () => {
      const highlighter = await loadHighlighter();
      const session = await highlighter.createSession(language);
      if (cancelled) return;
      if (!session) {
        publish("plain", []);
        return;
      }
      const collected: HighlightedLine[] = [];
      let batch = INITIAL_BATCH;
      while (collected.length < target) {
        const sliceStart = performance.now();
        while (collected.length < target && performance.now() - sliceStart < SLICE_BUDGET_MS) {
          const from = collected.length;
          const to = Math.min(target, from + batch);
          const batchStart = performance.now();
          const tokens = session.tokenizeLines(lines.slice(from, to));
          for (let i = 0; i < to - from; i += 1) collected.push(tokens[i] ?? []);
          const elapsed = performance.now() - batchStart;
          if (elapsed > SLICE_BUDGET_MS) batch = Math.max(1, Math.floor(batch / 4));
          else if (elapsed < SLICE_BUDGET_MS / 4) batch = Math.min(MAX_BATCH, batch * 2);
        }
        publish(collected.length < target ? "highlighting" : "done", collected.slice());
        if (collected.length < target) await nextTask();
        if (cancelled) return;
      }
    };

    run().catch((error: unknown) => {
      console.warn("[codeverse] Syntax highlighting failed; showing plain text.", error);
      publish("plain", []);
    });
    return () => {
      cancelled = true;
    };
  }, [lines, language, loadHighlighter, target]);

  if (!lines || !language || target === 0) return { status: "plain", tokens: [], target: 0 };
  if (stored && stored.source === lines && stored.language === language) {
    return { status: stored.status, tokens: stored.tokens, target: stored.target };
  }
  return { status: "loading", tokens: [], target };
}
