import { Deadline, ParseTimeoutError } from "./deadline";

function manualClock(start = 0) {
  let now = start;
  return {
    read: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("Deadline", () => {
  it.each([undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "treats %s as unbounded",
    (timeoutMs) => {
      const clock = manualClock();
      const deadline = new Deadline(timeoutMs, clock.read);
      clock.advance(1e9);
      expect(deadline.bounded).toBe(false);
      expect(deadline.expired()).toBe(false);
      expect(() => deadline.check()).not.toThrow();
    },
  );

  it("expires once the budget is spent", () => {
    const clock = manualClock(100);
    const deadline = new Deadline(50, clock.read);
    expect(deadline.bounded).toBe(true);
    clock.advance(49);
    expect(deadline.expired()).toBe(false);
    clock.advance(1);
    expect(deadline.expired()).toBe(true);
    expect(() => deadline.check()).toThrow(ParseTimeoutError);
  });

  it("reads the clock only periodically from tick()", () => {
    let reads = 0;
    const clock = () => {
      reads += 1;
      return 0;
    };
    const deadline = new Deadline(10, clock);
    const readsAfterConstruction = reads;
    for (let index = 0; index < 1_000; index += 1) deadline.tick();
    expect(reads - readsAfterConstruction).toBeLessThan(20);
  });

  it("tick() eventually throws after expiry", () => {
    const clock = manualClock();
    const deadline = new Deadline(5, clock.read);
    clock.advance(10);
    expect(() => {
      for (let index = 0; index < 10_000; index += 1) deadline.tick();
    }).toThrow(ParseTimeoutError);
  });
});
