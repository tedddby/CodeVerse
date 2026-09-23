import {
  NDJSON_CONTENT_TYPE,
  encodeEvent,
  type AnalysisErrorPayload,
  type AnalysisEvent,
} from "@/analysis/protocol";
import { errorPayloadFor } from "./errors";

/**
 * HTTP framing of the analysis protocol: one JSON event per line.
 *
 * Guarantees of `createAnalysisStreamResponse`:
 * - the body ends with exactly one "complete" or "error" event (a producer
 *   that returns or throws without one gets an INTERNAL error appended), then
 *   closes; events after the terminal one are dropped;
 * - a "heartbeat" line is written every `heartbeatMs` while the producer runs,
 *   so proxies do not close idle connections during long stages;
 * - when the client disconnects (request signal or stream cancellation), the
 *   producer's signal aborts and nothing more is written.
 */

export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Headers of every NDJSON analysis response. */
export function ndjsonHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers({
    "Content-Type": NDJSON_CONTENT_TYPE,
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  return headers;
}

/** A complete NDJSON response carrying a single error event (validation failures, 429s). */
export function ndjsonErrorResponse(
  status: number,
  error: AnalysisErrorPayload,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(encodeEvent({ type: "error", error }), {
    status,
    headers: ndjsonHeaders(extraHeaders),
  });
}

export type AnalysisProducer = (
  emit: (event: AnalysisEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

export interface AnalysisStreamOptions {
  /** The request's signal; aborts when the client disconnects. */
  signal?: AbortSignal;
  heartbeatMs?: number;
  /** Called with encoding or producer failures (for logging). */
  onError?: (error: unknown) => void;
}

function encodeSafely(event: AnalysisEvent, onError?: (error: unknown) => void): string | null {
  try {
    return encodeEvent(event);
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function createAnalysisStreamResponse(
  produce: AnalysisProducer,
  options: AnalysisStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const requestSignal = options.signal;
  const abort = () => controller.abort();
  let closed = false;
  let terminalSent = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    requestSignal?.removeEventListener("abort", abort);
  };

  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      const write = (line: string) => {
        if (closed) return;
        try {
          stream.enqueue(encoder.encode(line));
        } catch {
          // The consumer went away between the check and the write.
          stop();
          abort();
        }
      };
      const emit = (event: AnalysisEvent) => {
        if (closed || terminalSent || controller.signal.aborted) return;
        const terminal = event.type === "complete" || event.type === "error";
        let line = encodeSafely(event, options.onError);
        if (line === null) {
          if (!terminal) return;
          // An unencodable graph still ends the stream with a well-formed error.
          line = encodeEvent({ type: "error", error: errorPayloadFor("INTERNAL") });
        }
        if (terminal) terminalSent = true;
        write(line);
      };

      if (requestSignal?.aborted) controller.abort();
      else requestSignal?.addEventListener("abort", abort, { once: true });
      heartbeat = setInterval(
        () => emit({ type: "heartbeat" }),
        options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS,
      );

      void (async () => {
        try {
          await produce(emit, controller.signal);
        } catch (error) {
          options.onError?.(error);
        }
        if (!terminalSent && !controller.signal.aborted) {
          emit({ type: "error", error: errorPayloadFor("INTERNAL") });
        }
        stop();
        try {
          stream.close();
        } catch {
          // Already cancelled by the consumer.
        }
      })();
    },
    cancel() {
      stop();
      abort();
    },
  });

  return new Response(body, { status: 200, headers: ndjsonHeaders() });
}
