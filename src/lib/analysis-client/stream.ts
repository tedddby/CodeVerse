import type { AnalysisEvent } from "@/analysis/protocol";
import { parseAnalysisEventLine } from "./events";

/**
 * Incremental NDJSON reader for the analysis stream.
 *
 * - Decodes UTF-8 in streaming mode, so multi-byte characters split across
 *   network chunks are reassembled correctly.
 * - Splits on "\n" and tolerates "\r\n" line endings and blank lines.
 * - Scans only newly received text for line breaks, so a single huge line
 *   (the final graph of a large repository) is assembled in linear time.
 * - Malformed lines (invalid JSON, unknown event types, failed validation,
 *   oversized lines) are skipped and counted instead of aborting the stream.
 */

export interface NdjsonStreamSummary {
  /** Valid events yielded. */
  events: number;
  /** Lines skipped because they could not be parsed or validated. */
  malformedLines: number;
}

export interface MalformedLineInfo {
  /** 1-based line number within the stream. */
  lineNumber: number;
  reason: string;
}

export interface ReadNdjsonOptions {
  /** Called for every skipped line (diagnostics). */
  onMalformedLine?: (info: MalformedLineInfo) => void;
  /**
   * Longest accepted line in UTF-16 code units. Longer lines are discarded as
   * malformed without being buffered. Defaults to 256 Mi characters.
   */
  maxLineLength?: number;
}

export const DEFAULT_MAX_LINE_LENGTH = 256 * 1024 * 1024;

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Reads an `application/x-ndjson` analysis response and yields validated events.
 * The generator's return value summarizes what was read. Throws the abort reason
 * when `signal` aborts, and propagates network errors raised while reading.
 */
export async function* readNdjson(
  response: Response,
  signal?: AbortSignal,
  options: ReadNdjsonOptions = {},
): AsyncGenerator<AnalysisEvent, NdjsonStreamSummary, undefined> {
  const summary: NdjsonStreamSummary = { events: 0, malformedLines: 0 };
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  if (signal?.aborted) throw abortError(signal);
  if (!response.body) return summary;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  /** Text of the current, not yet terminated line, as received pieces. */
  let pending: string[] = [];
  let pendingLength = 0;
  /** True while dropping the remainder of an oversized line. */
  let discarding = false;
  /** Lines terminated so far. */
  let lineNumber = 0;

  const reject = (reason: string, line: number) => {
    summary.malformedLines += 1;
    options.onMalformedLine?.({ lineNumber: line, reason });
  };

  const resetPending = () => {
    pending = [];
    pendingLength = 0;
  };

  const completeLine = (rawLine: string, output: AnalysisEvent[]) => {
    lineNumber += 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    const result = parseAnalysisEventLine(line);
    if (!result.ok) {
      reject(result.reason, lineNumber);
      return;
    }
    summary.events += 1;
    output.push(result.event);
  };

  /** Consumes decoded text and returns the events of every line it completes. */
  const consume = (text: string): AnalysisEvent[] => {
    const output: AnalysisEvent[] = [];
    let start = 0;
    for (let newline = text.indexOf("\n"); newline !== -1; newline = text.indexOf("\n", start)) {
      const piece = text.slice(start, newline);
      start = newline + 1;
      if (discarding) {
        // The oversized line ends here; it was reported when it overflowed.
        discarding = false;
        lineNumber += 1;
        continue;
      }
      if (pendingLength + piece.length > maxLineLength) {
        resetPending();
        lineNumber += 1;
        reject("line too long", lineNumber);
        continue;
      }
      const line = pending.length > 0 ? pending.join("") + piece : piece;
      resetPending();
      completeLine(line, output);
    }
    const rest = text.slice(start);
    if (rest !== "" && !discarding) {
      if (pendingLength + rest.length > maxLineLength) {
        resetPending();
        discarding = true;
        reject("line too long", lineNumber + 1);
      } else {
        pending.push(rest);
        pendingLength += rest.length;
      }
    }
    return output;
  };

  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError(signal);
      const events = consume(done ? decoder.decode() : decoder.decode(value, { stream: true }));
      for (const event of events) yield event;
      if (done) break;
    }
    // A final line without a trailing newline is still a line.
    if (!discarding && pending.length > 0) {
      const events: AnalysisEvent[] = [];
      completeLine(pending.join(""), events);
      resetPending();
      for (const event of events) yield event;
    }
    return summary;
  } finally {
    // Runs on completion, errors and early `return()` from the consumer: release the connection.
    reader.cancel().catch(() => undefined);
  }
}
