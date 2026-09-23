// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivePhase, ENTER_TRANSITION_MS, MIN_LOADING_MS, useExplorerPhase, type ExplorerPhaseInput } from "./use-explorer-phase";

describe("derivePhase", () => {
  const base = { status: "complete", worldReady: true, reducedMotion: false, minimumShown: true, entered: false } as const;

  it("maps inputs to phases", () => {
    expect(derivePhase({ ...base, status: "loading" })).toBe("loading");
    expect(derivePhase({ ...base, status: "preview" })).toBe("loading");
    expect(derivePhase({ ...base, worldReady: false })).toBe("loading");
    expect(derivePhase({ ...base, minimumShown: false })).toBe("loading");
    expect(derivePhase(base)).toBe("entering");
    expect(derivePhase({ ...base, entered: true })).toBe("explorer");
    expect(derivePhase({ ...base, status: "error", entered: true })).toBe("error");
  });
});

describe("useExplorerPhase", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds the loading screen for a minimum time, then plays the entrance transition", () => {
    const { result, rerender } = renderHook((props: ExplorerPhaseInput) => useExplorerPhase(props), {
      initialProps: { status: "loading", worldReady: false, reducedMotion: false },
    });
    rerender({ status: "complete", worldReady: true, reducedMotion: false });
    expect(result.current).toBe("loading");
    act(() => vi.advanceTimersByTime(MIN_LOADING_MS));
    expect(result.current).toBe("entering");
    act(() => vi.advanceTimersByTime(ENTER_TRANSITION_MS));
    expect(result.current).toBe("explorer");
  });

  it("skips the delays with reduced motion", () => {
    const { result } = renderHook(() => useExplorerPhase({ status: "complete", worldReady: true, reducedMotion: true }));
    act(() => vi.advanceTimersByTime(0));
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe("explorer");
  });

  it("waits for the world before entering", () => {
    const { result, rerender } = renderHook((props: ExplorerPhaseInput) => useExplorerPhase(props), {
      initialProps: { status: "complete", worldReady: false, reducedMotion: false },
    });
    act(() => vi.advanceTimersByTime(MIN_LOADING_MS * 3));
    expect(result.current).toBe("loading");
    rerender({ status: "complete", worldReady: true, reducedMotion: false });
    expect(result.current).toBe("entering");
  });
});
