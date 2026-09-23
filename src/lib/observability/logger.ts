import { redactSecrets, registerSecret } from "./redact";

/**
 * Structured JSON-lines logger.
 *
 * Every record is one line: `{"time":"…","level":"info","msg":"…",…fields}`.
 * All fields pass through `redactSecrets`, so tokens, credentials and
 * credential-like keys never reach the output even when a caller logs a raw
 * error or request object. Debug/info go to stdout, warn/error to stderr.
 *
 * The level comes from `CODEVERSE_LOG_LEVEL` (debug | info | warn | error |
 * silent, default info).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogThreshold = LogLevel | "silent";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every record (later fields win over inherited ones). */
  child(fields: LogFields): Logger;
}

/** Destination of serialized records. */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

export interface LoggerOptions {
  level?: LogThreshold;
  sink?: LogSink;
  /** Clock for the `time` field (epoch milliseconds). */
  now?: () => number;
  /** Fields added to every record. */
  fields?: LogFields;
}

const LEVEL_RANK: Record<LogThreshold, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Keys owned by the record envelope; fields with these names are prefixed. */
const RESERVED_KEYS = new Set(["time", "level", "msg"]);

/** Parses a level name, falling back to `fallback` for anything unrecognized. */
export function parseLogLevel(
  value: string | undefined,
  fallback: LogThreshold = "info",
): LogThreshold {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && Object.hasOwn(LEVEL_RANK, normalized)
    ? (normalized as LogThreshold)
    : fallback;
}

/** Writes to stdout/stderr, falling back to the console where streams are unavailable. */
export const processSink: LogSink = {
  write(level, line) {
    const stream =
      typeof process !== "undefined"
        ? level === "warn" || level === "error"
          ? process.stderr
          : process.stdout
        : undefined;
    if (stream && typeof stream.write === "function") {
      stream.write(`${line}\n`);
      return;
    }
    console.error(line);
  },
};

function serialize(level: LogLevel, time: number, message: string, fields: LogFields): string {
  const record: Record<string, unknown> = {
    time: new Date(Number.isFinite(time) ? time : Date.now()).toISOString(),
    level,
    msg: redactSecrets(message),
  };
  const redacted = redactSecrets(fields);
  if (redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)) {
    for (const [key, value] of Object.entries(redacted)) {
      record[RESERVED_KEYS.has(key) ? `field.${key}` : key] = value;
    }
  }
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ time: record.time, level, msg: record.msg, serializationError: true });
  }
}

class JsonLogger implements Logger {
  readonly #threshold: number;
  readonly #sink: LogSink;
  readonly #now: () => number;
  readonly #fields: LogFields;
  readonly #options: LoggerOptions;

  constructor(options: LoggerOptions) {
    this.#options = options;
    this.#threshold = LEVEL_RANK[options.level ?? "info"];
    this.#sink = options.sink ?? processSink;
    this.#now = options.now ?? Date.now;
    this.#fields = options.fields ?? {};
  }

  debug(message: string, fields?: LogFields): void {
    this.#log("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.#log("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.#log("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.#log("error", message, fields);
  }

  child(fields: LogFields): Logger {
    return new JsonLogger({ ...this.#options, fields: { ...this.#fields, ...fields } });
  }

  #log(level: LogLevel, message: string, fields: LogFields | undefined): void {
    if (LEVEL_RANK[level] < this.#threshold) return;
    try {
      const merged = fields ? { ...this.#fields, ...fields } : this.#fields;
      this.#sink.write(level, serialize(level, this.#now(), message, merged));
    } catch {
      // Logging must never break the request that is being logged.
    }
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new JsonLogger(options);
}

/** A logger that discards everything (tests, callers that opt out of logging). */
export const silentLogger: Logger = createLogger({ level: "silent" });

// The configured token is masked literally, whatever its format.
registerSecret(typeof process !== "undefined" ? process.env.GITHUB_TOKEN : undefined);

/** Process-wide logger. */
export const logger: Logger = createLogger({
  level: parseLogLevel(
    typeof process !== "undefined" ? process.env.CODEVERSE_LOG_LEVEL : undefined,
  ),
  fields: { service: "codeverse" },
});
