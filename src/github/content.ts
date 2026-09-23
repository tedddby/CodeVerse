import type { SourceFileResult } from "@/sources/types";
import { throwIfAborted } from "./async";

/**
 * Byte-level helpers for downloaded file content: bounded streaming reads,
 * binary detection and UTF-8 decoding. Shared by every provider that reads
 * raw bytes so all sources classify content identically.
 */

/** Number of leading bytes inspected by `looksBinary`. */
export const BINARY_SNIFF_BYTES = 8 * 1024;
/** Share of control bytes above which content is considered binary. */
const CONTROL_BYTE_RATIO = 0.3;

/**
 * Heuristic used by Git and most editors: content is binary when its first
 * 8 KB contain a NUL byte or mostly control bytes (other than \t \n \f \r).
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  if (length === 0) return false;
  let control = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index] as number;
    if (byte === 0) return true;
    const isControl =
      (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) ||
      byte === 0x7f;
    if (isControl) control += 1;
  }
  return control / length > CONTROL_BYTE_RATIO;
}

/**
 * Decodes UTF-8 leniently (invalid sequences become U+FFFD). A leading byte
 * order mark is dropped by the decoder, so content never starts with U+FEFF.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
}

/** Classifies fully-read content (already known to be within the byte budget). */
export function classifyContent(bytes: Uint8Array): SourceFileResult {
  if (looksBinary(bytes)) return { kind: "binary", size: bytes.length };
  return { kind: "text", content: decodeUtf8(bytes), size: bytes.length };
}

export type BoundedReadResult =
  { kind: "complete"; bytes: Uint8Array } | { kind: "overflow"; bytesRead: number };

/**
 * Reads a response body up to `maxBytes`, cancelling the stream as soon as the
 * budget is exceeded so oversized downloads stop early.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedReadResult> {
  const body = response.body;
  if (!body) return { kind: "complete", bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "overflow", bytesRead: total };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { kind: "complete", bytes: concatChunks(chunks, total) };
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Cancels a response body we do not intend to read, releasing the connection. */
export async function discardBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel().catch(() => undefined);
}
