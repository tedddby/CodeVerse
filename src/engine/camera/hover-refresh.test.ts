import { HOVER_REFRESH_INTERVAL, HoverRefresh } from "./hover-refresh";

function pointer(type: string, buttons = 0): Event {
  return Object.assign(new Event(type), { buttons });
}

function setup() {
  const element = new EventTarget();
  const windowTarget = new EventTarget();
  const refresh = new HoverRefresh();
  const unbind = refresh.bind(element, windowTarget);
  return { element, windowTarget, refresh, unbind };
}

describe("HoverRefresh", () => {
  it("does nothing until the pointer is over the canvas", () => {
    const { element, refresh } = setup();
    expect(refresh.frame(0, true)).toBe(false);
    element.dispatchEvent(pointer("pointermove"));
    // The move that happened while the pointer was outside is still pending.
    expect(refresh.frame(0.01, false)).toBe(true);
  });

  it("re-evaluates at most every interval while the view moves, and once after it settles", () => {
    const { element, refresh } = setup();
    element.dispatchEvent(pointer("pointerenter"));
    expect(refresh.frame(0, false)).toBe(false);
    expect(refresh.frame(1, true)).toBe(true);
    expect(refresh.frame(1 + HOVER_REFRESH_INTERVAL / 2, true)).toBe(false);
    // The camera stopped: the pending change still lands after the interval...
    expect(refresh.frame(1 + HOVER_REFRESH_INTERVAL, false)).toBe(true);
    // ...and an idle view never re-raycasts.
    expect(refresh.frame(2, false)).toBe(false);
    expect(refresh.frame(3, false)).toBe(false);
  });

  it("waits while a button is held (drags) and after the pointer leaves", () => {
    const { element, windowTarget, refresh } = setup();
    element.dispatchEvent(pointer("pointermove"));
    element.dispatchEvent(pointer("pointerdown", 1));
    expect(refresh.frame(1, true)).toBe(false);
    windowTarget.dispatchEvent(pointer("pointerup"));
    expect(refresh.frame(1.01, false)).toBe(true);

    element.dispatchEvent(pointer("pointermove", 2));
    expect(refresh.frame(2, true)).toBe(false);
    element.dispatchEvent(pointer("pointermove", 0));
    element.dispatchEvent(pointer("pointerleave"));
    expect(refresh.frame(3, true)).toBe(false);
  });

  it("stops tracking once unbound", () => {
    const { element, refresh, unbind } = setup();
    unbind();
    element.dispatchEvent(pointer("pointermove"));
    expect(refresh.frame(1, true)).toBe(false);
  });
});
