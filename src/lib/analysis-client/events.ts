import {
  ANALYSIS_STAGES,
  ERROR_COPY,
  type AnalysisErrorCode,
  type AnalysisErrorPayload,
  type AnalysisEvent,
  type AnalysisStageId,
  type StageEvent,
  type StageStatus,
} from "@/analysis/protocol";
import { GRAPH_SCHEMA_VERSION, type RepositoryGraph } from "@/graph/model/types";

/**
 * Client-side validation of analysis stream events.
 *
 * The analysis API is same-origin, but its payload embeds repository data and
 * travels through proxies, so every line is validated before it can reach the
 * store. Validation is intentionally shallow for graphs (tens of megabytes for
 * large repositories): structural checks only, no per-node schema walk.
 */

const STAGE_IDS: ReadonlySet<string> = new Set(ANALYSIS_STAGES);
const STAGE_STATUSES: ReadonlySet<string> = new Set<StageStatus>([
  "start",
  "progress",
  "done",
  "skipped",
  "warning",
]);
const ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_COPY));

/** Longest stage message kept; longer messages are truncated with an ellipsis. */
export const MAX_STAGE_MESSAGE_LENGTH = 160;
const MAX_ERROR_TITLE_LENGTH = 200;
const MAX_ERROR_MESSAGE_LENGTH = 600;

export type ParsedEventResult = { ok: true; event: AnalysisEvent } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip control characters (keeps tabs/newlines out of single-line UI) and trim.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (cleaned === "") return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function isAnalysisStageId(value: unknown): value is AnalysisStageId {
  return typeof value === "string" && STAGE_IDS.has(value);
}

export function isAnalysisErrorCode(value: unknown): value is AnalysisErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value);
}

/** Structural check that a value is a RepositoryGraph produced by this analyzer version. */
export function isRepositoryGraphLike(value: unknown): value is RepositoryGraph {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== GRAPH_SCHEMA_VERSION) return false;
  const repository = value.repository;
  if (
    !isRecord(repository) ||
    typeof repository.fullName !== "string" ||
    typeof repository.id !== "string"
  ) {
    return false;
  }
  if (typeof value.rootDirectoryId !== "string") return false;
  const arrays = [
    "directories",
    "files",
    "symbols",
    "dependencies",
    "externalPackages",
    "commits",
    "contributors",
    "languages",
  ];
  if (!arrays.every((key) => Array.isArray(value[key]))) return false;
  return isRecord(value.timeline) && isRecord(value.analysis);
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/**
 * Normalizes an untrusted error payload. Unknown codes become INTERNAL; missing
 * or invalid copy falls back to ERROR_COPY. Returns null for non-objects.
 */
export function normalizeErrorPayload(value: unknown): AnalysisErrorPayload | null {
  if (!isRecord(value)) return null;
  const code: AnalysisErrorCode = isAnalysisErrorCode(value.code) ? value.code : "INTERNAL";
  const copy = ERROR_COPY[code];
  const payload: AnalysisErrorPayload = {
    code,
    title: cleanText(value.title, MAX_ERROR_TITLE_LENGTH) ?? copy.title,
    message: cleanText(value.message, MAX_ERROR_MESSAGE_LENGTH) ?? copy.message,
  };
  if (isValidIsoDate(value.retryAt)) payload.retryAt = new Date(value.retryAt).toISOString();
  return payload;
}

/** Builds an error payload from the canonical copy for a code, with an optional message override. */
export function errorPayload(
  code: AnalysisErrorCode,
  overrides?: Partial<Omit<AnalysisErrorPayload, "code">>,
): AnalysisErrorPayload {
  return { code, ...ERROR_COPY[code], ...overrides };
}

/** Validates one decoded JSON value as an AnalysisEvent. */
export function toAnalysisEvent(value: unknown): ParsedEventResult {
  if (!isRecord(value)) return { ok: false, reason: "not an object" };
  switch (value.type) {
    case "stage": {
      if (!isAnalysisStageId(value.stage)) return { ok: false, reason: "unknown stage" };
      if (typeof value.status !== "string" || !STAGE_STATUSES.has(value.status)) {
        return { ok: false, reason: "unknown stage status" };
      }
      const event: StageEvent = {
        type: "stage",
        stage: value.stage,
        status: value.status as StageStatus,
      };
      if (typeof value.progress === "number" && Number.isFinite(value.progress)) {
        event.progress = Math.min(1, Math.max(0, value.progress));
      }
      const message = cleanText(value.message, MAX_STAGE_MESSAGE_LENGTH);
      if (message) event.message = message;
      return { ok: true, event };
    }
    case "preview":
    case "complete": {
      if (!isRepositoryGraphLike(value.graph)) return { ok: false, reason: "invalid graph" };
      return { ok: true, event: { type: value.type, graph: value.graph } };
    }
    case "error": {
      const error = normalizeErrorPayload(value.error);
      if (!error) return { ok: false, reason: "invalid error payload" };
      return { ok: true, event: { type: "error", error } };
    }
    case "heartbeat":
      return { ok: true, event: { type: "heartbeat" } };
    default:
      return {
        ok: false,
        reason: typeof value.type === "string" ? "unknown event type" : "missing event type",
      };
  }
}

/** Parses and validates one NDJSON line. */
export function parseAnalysisEventLine(line: string): ParsedEventResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  return toAnalysisEvent(value);
}

/** Largest error body inspected; error responses are small, anything bigger is not ours. */
const MAX_ERROR_BODY_LENGTH = 64 * 1024;

/**
 * Extracts an error payload from an HTTP error body. Accepts the NDJSON stream
 * format (`{"type":"error","error":{...}}` on any line) and plain JSON
 * (`{"error":{...}}`). Returns null when the body carries no usable payload.
 */
export function extractErrorPayload(body: string): AnalysisErrorPayload | null {
  const text = body.length > MAX_ERROR_BODY_LENGTH ? body.slice(0, MAX_ERROR_BODY_LENGTH) : body;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line[0] !== "{") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(value) && isRecord(value.error)) {
      const payload = normalizeErrorPayload(value.error);
      if (payload) return payload;
    }
  }
  // A pretty-printed JSON document spans several lines.
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && isRecord(value.error)) return normalizeErrorPayload(value.error);
  } catch {
    // Not JSON.
  }
  return null;
}

/**
 * Fallback error for an HTTP failure whose body carried no usable error payload.
 * `retryAfter` is the raw Retry-After header (seconds or HTTP date), when present.
 */
export function errorFromHttpStatus(
  status: number,
  retryAfter?: string | null,
  now: number = Date.now(),
): AnalysisErrorPayload {
  let code: AnalysisErrorCode;
  if (status === 400 || status === 422) code = "INVALID_REPOSITORY";
  else if (status === 401) code = "UNAUTHORIZED";
  else if (status === 403) code = "PRIVATE_OR_INACCESSIBLE";
  else if (status === 404) code = "NOT_FOUND";
  else if (status === 408 || status === 504) code = "TIMEOUT";
  else if (status === 429) code = "CLIENT_RATE_LIMITED";
  else if (status === 502 || status === 503) code = "UPSTREAM_ERROR";
  else code = "INTERNAL";

  const payload = errorPayload(code);
  const retryAt = parseRetryAfter(retryAfter, now);
  if (retryAt) payload.retryAt = retryAt;
  return payload;
}

/** Converts a Retry-After header (delta-seconds or HTTP date) to an ISO date. */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): string | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d{1,7}$/.test(trimmed)) return new Date(now + Number(trimmed) * 1000).toISOString();
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : new Date(date).toISOString();
}
