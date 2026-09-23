// @vitest-environment jsdom
import {
  HoverChannel,
  ThrottledValue,
  isDragClick,
  suspendHoverWhileDragging,
  type Scheduler,
} from "./pointer";

function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const scheduler: Scheduler = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers.entries()]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  return { scheduler, advance, pendingTimers: () => timers.size };
}

describe("isDragClick", () => {
  it("treats small pointer travel as a click", () => {
    expect(isDragClick(0)).toBe(false);
    expect(isDragClick(3)).toBe(false);
    expect(isDragClick(12)).toBe(true);
    expect(isDragClick(Number.NaN)).toBe(true);
  });
});

describe("ThrottledValue", () => {
  it("applies the first value immediately and throttles the rest", () => {
    const { scheduler, advance } = fakeScheduler();
    const applied: string[] = [];
    const throttled = new ThrottledValue<string>((v) => applied.push(v), 50, Object.is, scheduler);
    throttled.set("a");
    throttled.set("b");
    throttled.set("c");
    expect(applied).toEqual(["a"]);
    advance(49);
    expect(applied).toEqual(["a"]);
    advance(1);
    expect(applied).toEqual(["a", "c"]);
  });

  it("does not re-apply identical values", () => {
    const { scheduler, advance } = fakeScheduler();
    const applied: Array<string | null> = [];
    const throttled = new ThrottledValue<string | null>(
      (v) => applied.push(v),
      50,
      Object.is,
      scheduler,
    );
    throttled.set("a");
    advance(100);
    throttled.set("a");
    advance(100);
    throttled.set(null);
    expect(applied).toEqual(["a", null]);
  });

  it("flushes on demand and cancels on dispose", () => {
    const { scheduler, advance, pendingTimers } = fakeScheduler();
    const applied: number[] = [];
    const throttled = new ThrottledValue<number>((v) => applied.push(v), 50, Object.is, scheduler);
    throttled.set(1);
    throttled.set(2);
    throttled.flush();
    expect(applied).toEqual([1, 2]);
    throttled.set(3);
    expect(pendingTimers()).toBe(1);
    throttled.dispose();
    advance(100);
    expect(applied).toEqual([1, 2]);
    expect(pendingTimers()).toBe(0);
  });

  it("supports custom equality and reset", () => {
    const { scheduler, advance } = fakeScheduler();
    const applied: Array<{ id: string }> = [];
    const throttled = new ThrottledValue<{ id: string }>(
      (v) => applied.push(v),
      10,
      (a, b) => a.id === b.id,
      scheduler,
    );
    throttled.set({ id: "x" });
    advance(20);
    throttled.set({ id: "x" });
    expect(applied).toHaveLength(1);
    throttled.reset();
    advance(20);
    throttled.set({ id: "x" });
    expect(applied).toHaveLength(2);
  });
});

describe("HoverChannel", () => {
  it("passes hover through, and reads as nothing while suspended", () => {
    const { scheduler, advance } = fakeScheduler();
    const applied: Array<string | null> = [];
    const channel = new HoverChannel<string>(
      new ThrottledValue((v) => applied.push(v), 10, Object.is, scheduler),
    );
    channel.set("a");
    channel.suspend(true);
    expect(applied).toEqual(["a", null]);
    channel.set("b");
    advance(20);
    expect(applied).toEqual(["a", null]);
    channel.suspend(false);
    channel.set("c");
    advance(20);
    expect(applied).toEqual(["a", null, "c"]);
  });
});

describe("suspendHoverWhileDragging", () => {
  function pointer(type: string, x: number, y: number, pointerId = 1): Event {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    return event;
  }

  it("suspends only once the pointer travels beyond the click tolerance", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const calls: boolean[] = [];
    let suspended = false;
    const channel = {
      suspend: (value: boolean) => {
        suspended = value;
        calls.push(value);
      },
      isSuspended: () => suspended,
    };
    const cleanup = suspendHoverWhileDragging(element, channel);
    element.dispatchEvent(pointer("pointerdown", 10, 10));
    window.dispatchEvent(pointer("pointermove", 12, 11));
    expect(calls).toEqual([]);
    window.dispatchEvent(pointer("pointermove", 40, 10));
    expect(calls).toEqual([true]);
    window.dispatchEvent(pointer("pointerup", 40, 10));
    expect(calls).toEqual([true, false]);

    cleanup();
    element.dispatchEvent(pointer("pointerdown", 0, 0));
    window.dispatchEvent(pointer("pointermove", 100, 100));
    expect(calls).toEqual([true, false]);
    element.remove();
  });

  it("ignores other pointers", () => {
    const element = document.createElement("div");
    const calls: boolean[] = [];
    const cleanup = suspendHoverWhileDragging(element, {
      suspend: (v) => calls.push(v),
      isSuspended: () => false,
    });
    element.dispatchEvent(pointer("pointerdown", 0, 0, 1));
    window.dispatchEvent(pointer("pointermove", 50, 50, 2));
    expect(calls).toEqual([]);
    cleanup();
  });
});
