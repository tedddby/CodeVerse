import type { FileAnalysisResult } from "@/graph/builders/assemble";
import type { FetchPlan, InventoryFile } from "@/graph/builders/inventory";
import { formatInteger, pluralize } from "@/lib/utils/format";
import { countLines } from "@/parser/lines";
import type { SourceParser } from "@/parser";
import type { ParseFailure } from "@/parser/types";
import { BUDGET_FRACTIONS, monotonicNow, yieldToEventLoop, type PipelineContext } from "./context";
import { parseMessage, progressMessage } from "./messages";

/**
 * Stage "parse": AST-parses the downloaded parse files and line-counts the
 * content-only downloads.
 *
 * Parsing one file is synchronous CPU work, so the stage yields to the event
 * loop every `YIELD_EVERY_FILES` files or `YIELD_EVERY_MS` milliseconds; this
 * keeps the NDJSON response (and other requests) flowing on large batches.
 */

export const YIELD_EVERY_FILES = 20;
export const YIELD_EVERY_MS = 30;

export const PARSE_REASONS = {
  timeBudget: "Not parsed: the analysis time budget ran out; lines counted only",
  crash: "The parser failed on this file",
  grammar: "The parser for this language could not be loaded",
} as const;

export interface ParseStageInput {
  parser: SourceParser;
  plan: FetchPlan;
  inventoryByPath: ReadonlyMap<string, InventoryFile>;
  /** Downloaded text by path. */
  contents: ReadonlyMap<string, string>;
  /** Per-file results; the stage adds its outcomes to this map. */
  analyses: Map<string, FileAnalysisResult>;
}

export interface ParseStageResult {
  parsed: number;
  partial: number;
  failed: number;
  /** Parse files that were only line-counted because the time budget ran out. */
  budgetSkipped: number;
}

function failureReason(failure: ParseFailure, timeoutMs: number): string {
  switch (failure.reason) {
    case "timeout":
      return `Parsing timed out after ${Math.round(timeoutMs / 100) / 10}s`;
    case "grammar-unavailable":
      return PARSE_REASONS.grammar;
    case "parser-crash":
    case "too-large":
      return PARSE_REASONS.crash;
  }
}

export async function runParseStage(
  context: PipelineContext,
  input: ParseStageInput,
): Promise<ParseStageResult> {
  const { limits } = context;
  const result: ParseStageResult = { parsed: 0, partial: 0, failed: 0, budgetSkipped: 0 };
  const parseQueue = input.plan.parseFiles.filter((path) => input.contents.has(path));
  const countQueue = input.plan.contentOnlyFiles.filter(
    (path) => input.contents.has(path) && !input.analyses.has(path),
  );
  const total = parseQueue.length + countQueue.length;
  const stage = context.startStage("parse");
  if (total === 0) {
    stage.finish("skipped", "No source files to parse");
    return result;
  }

  let processed = 0;
  let sinceYield = 0;
  let lastYieldAt = monotonicNow();
  const step = async () => {
    processed += 1;
    sinceYield += 1;
    stage.progress(processed, total, progressMessage(processed, total));
    if (sinceYield >= YIELD_EVERY_FILES || monotonicNow() - lastYieldAt >= YIELD_EVERY_MS) {
      await yieldToEventLoop();
      sinceYield = 0;
      lastYieldAt = monotonicNow();
    }
    context.throwIfAborted();
  };

  for (const path of parseQueue) {
    const content = input.contents.get(path) ?? "";
    const language = input.inventoryByPath.get(path)?.parserLanguage ?? null;
    if (language === null) {
      input.analyses.set(path, { status: "content-only", lines: countLines(content) });
    } else if (context.budgetExceeded(BUDGET_FRACTIONS.parse)) {
      result.budgetSkipped += 1;
      input.analyses.set(path, {
        status: "content-only",
        lines: countLines(content),
        statusReason: PARSE_REASONS.timeBudget,
      });
    } else {
      const outcome = await input.parser
        .parse(
          { path, content, language },
          { timeoutMs: limits.parseTimeoutMs, maxBytes: limits.maxParseBytes },
        )
        .catch((error: unknown): ParseFailure => {
          context.logger.warn("parser threw unexpectedly", { path, error });
          return { ok: false, reason: "parser-crash", message: "", lines: countLines(content) };
        });
      if (outcome.ok) {
        const { ok: _ok, ...parse } = outcome;
        if (parse.hasErrors) result.partial += 1;
        else result.parsed += 1;
        input.analyses.set(path, {
          status: parse.hasErrors ? "partial" : "parsed",
          parse,
          lines: parse.lines,
        });
      } else if (outcome.reason === "too-large") {
        // Larger than the parse limit once decoded: keep the exact line count.
        input.analyses.set(path, { status: "content-only", lines: outcome.lines });
      } else {
        result.failed += 1;
        input.analyses.set(path, {
          status: "failed",
          statusReason: failureReason(outcome, limits.parseTimeoutMs),
          lines: outcome.lines,
        });
      }
    }
    await step();
  }

  for (const path of countQueue) {
    input.analyses.set(path, {
      status: "content-only",
      lines: countLines(input.contents.get(path) ?? ""),
    });
    await step();
  }

  const analysed = result.parsed + result.partial;
  if (result.budgetSkipped > 0) {
    const eligible = Math.max(input.plan.eligibleParseFiles, analysed + result.budgetSkipped);
    const skipped = result.budgetSkipped;
    context.addWarning({
      code: "PARSE_LIMIT",
      message: `Parsed ${formatInteger(analysed)} of ${formatInteger(eligible)} eligible source files; parsing stopped early to stay within the analysis time budget, so ${pluralize(skipped, "file")} ${skipped === 1 ? "shows" : "show"} line counts only.`,
      detail: { parsed: analysed, eligible, stoppedEarly: result.budgetSkipped },
    });
    stage.finish("warning", "Stopped early to stay within the analysis budget");
  } else {
    stage.finish("done", parseMessage(analysed, result.failed));
  }
  return result;
}
