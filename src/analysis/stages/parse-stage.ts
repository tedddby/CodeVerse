import type { FileAnalysisResult } from "@/graph/builders/assemble";
import type { FetchPlan, InventoryFile } from "@/graph/builders/inventory";
import { formatInteger, pluralize } from "@/lib/utils/format";
import { countLines } from "@/parser/lines";
import type { SourceParser } from "@/parser";
import type { ParseFailure, ParseResult } from "@/parser/types";
import { BUDGET_FRACTIONS, monotonicNow, yieldToEventLoop, type PipelineContext } from "./context";
import {
  MAX_GRAPH_SYMBOLS,
  MAX_IMPORTS_PER_FILE,
  MAX_SYMBOLS_PER_FILE,
  capExtraction,
  createExtractionBudget,
  type CappedExtraction,
} from "./extraction-limits";
import { parseMessage, progressMessage } from "./messages";

/**
 * Stage "parse": AST-parses the downloaded parse files and line-counts the
 * content-only downloads.
 *
 * Parsing one file is synchronous CPU work, so the stage yields to the event
 * loop every `YIELD_EVERY_FILES` files or `YIELD_EVERY_MS` milliseconds; this
 * keeps the NDJSON response (and other requests) flowing on large batches.
 * Extraction results are capped per file and per graph (see
 * `extraction-limits.ts`), in parse (priority) order.
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
  /** Parsed files whose symbols, imports or exports were capped. */
  limited: number;
}

/** "Symbol limit reached: kept 2,000 of 9,412 symbols and 1,000 of 3,100 imports". */
function limitReason(original: ParseResult, capped: CappedExtraction): string {
  const parts: string[] = [];
  const describe = (kept: number, dropped: number, noun: string) => {
    if (dropped > 0)
      parts.push(`${formatInteger(kept)} of ${formatInteger(kept + dropped)} ${noun}`);
  };
  describe(capped.parse.symbols.length, capped.droppedSymbols, "symbols");
  describe(capped.parse.imports.length, capped.droppedImports, "imports");
  describe(capped.parse.exports.length, capped.droppedExports, "exports");
  const kept =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`
      : parts.join("");
  return original.hasErrors
    ? `Parsed with syntax errors; symbol limit reached: kept ${kept}`
    : `Symbol limit reached: kept ${kept}`;
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
  const result: ParseStageResult = {
    parsed: 0,
    partial: 0,
    failed: 0,
    budgetSkipped: 0,
    limited: 0,
  };
  const extractionBudget = createExtractionBudget();
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
        const capped = capExtraction(parse, extractionBudget);
        const limited = capped.droppedSymbols + capped.droppedImports + capped.droppedExports > 0;
        const partial = parse.hasErrors || limited;
        if (partial) result.partial += 1;
        else result.parsed += 1;
        const analysis: FileAnalysisResult = {
          status: partial ? "partial" : "parsed",
          parse: capped.parse,
          lines: parse.lines,
        };
        if (limited) {
          result.limited += 1;
          analysis.statusReason = limitReason(parse, capped);
        }
        input.analyses.set(path, analysis);
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

  if (result.limited > 0) {
    context.addWarning({
      code: "SYMBOL_LIMIT",
      message: `${pluralize(result.limited, "file")} declared more symbols or imports than CodeVerse shows (${formatInteger(MAX_SYMBOLS_PER_FILE)} symbols and ${formatInteger(MAX_IMPORTS_PER_FILE)} imports per file, ${formatInteger(MAX_GRAPH_SYMBOLS)} symbols per repository); top-level declarations were kept first.`,
      detail: { files: result.limited },
    });
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
