/** Thrown by {@link Deadline.check} once the per-file time budget is spent. */
export class ParseTimeoutError extends Error {
  constructor() {
    super("The parse time budget was exhausted");
    this.name = "ParseTimeoutError";
  }
}

/** How many {@link Deadline.tick} calls happen between two clock reads. */
const TICKS_PER_CLOCK_READ = 128;

const defaultClock = (): number => performance.now();

/**
 * Per-file time budget shared by tree-sitter (through its progress callback)
 * and the extraction walkers (through `tick()`), so a pathological file can
 * never stall the analysis for longer than the configured timeout.
 */
export class Deadline {
  private readonly expiresAt: number;
  private readonly clock: () => number;
  private ticks = 0;

  /**
   * @param timeoutMs Budget in milliseconds. `undefined`, non-finite and
   *   non-positive values mean "unbounded".
   * @param clock Monotonic clock in milliseconds (injectable for tests).
   */
  constructor(timeoutMs?: number, clock: () => number = defaultClock) {
    this.clock = clock;
    const bounded = timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0;
    this.expiresAt = bounded ? clock() + timeoutMs : Number.POSITIVE_INFINITY;
  }

  /** Whether a finite budget applies. */
  get bounded(): boolean {
    return this.expiresAt !== Number.POSITIVE_INFINITY;
  }

  expired(): boolean {
    return this.bounded && this.clock() >= this.expiresAt;
  }

  /** Throws {@link ParseTimeoutError} when the budget is spent. */
  check(): void {
    if (this.expired()) throw new ParseTimeoutError();
  }

  /** Cheap per-node check for walkers: reads the clock only every few calls. */
  tick(): void {
    this.ticks += 1;
    if (this.ticks % TICKS_PER_CLOCK_READ === 0) this.check();
  }
}
