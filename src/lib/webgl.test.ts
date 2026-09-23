// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectWebGL } from "./webgl";

function fakeContext(loseContext = vi.fn()) {
  return {
    getParameter: vi.fn(),
    getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectWebGL", () => {
  it("prefers WebGL2 and releases the probe context", () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((kind: string) => (kind === "webgl2" ? fakeContext(loseContext) : null)) as never);
    expect(detectWebGL()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0]?.[0]).toBe("webgl2");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to WebGL1", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((kind: string) => (kind === "webgl" ? fakeContext() : null)) as never);
    expect(detectWebGL()).toBe(true);
    expect(getContext.mock.calls.map((call) => call[0])).toEqual(["webgl2", "webgl"]);
  });

  it("returns false when no context can be created or creation throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
    expect(detectWebGL()).toBe(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
      throw new Error("GPU process crashed");
    }) as never);
    expect(detectWebGL()).toBe(false);
  });

  it("survives a context whose lose-context extension throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      getParameter: vi.fn(),
      getExtension: () => {
        throw new Error("context lost");
      },
    })) as never);
    expect(detectWebGL()).toBe(true);
  });
});
