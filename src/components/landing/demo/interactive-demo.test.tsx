// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveDemo } from "./interactive-demo";

const webgl = vi.hoisted(() => ({ available: true, probes: 0 }));
const world = vi.hoisted(() => ({ mounts: 0, crash: false }));

vi.mock("@/lib/webgl", () => ({
  detectWebGL: () => {
    webgl.probes += 1;
    return webgl.available;
  },
}));

// The real world pulls in three.js; the gate only needs its callback contract.
vi.mock("./demo-world", () => ({
  default: function FakeDemoWorld({
    onReady,
    onError,
    visible,
  }: {
    onReady: () => void;
    onError: (message: string) => void;
    visible: boolean;
  }) {
    world.mounts += 1;
    if (world.crash) throw new Error("WebGL context lost");
    return (
      <div data-testid="world" data-visible={String(visible)}>
        <button type="button" onClick={onReady}>
          simulate first frame
        </button>
        <button type="button" onClick={() => onError("layout failed")}>
          simulate layout failure
        </button>
      </div>
    );
  },
}));

type ObserverCallback = (entries: Array<Pick<IntersectionObserverEntry, "isIntersecting">>) => void;
let observers: Array<{ callback: ObserverCallback; options?: IntersectionObserverInit }> = [];

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    observers.push({ callback, options });
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function scrollDemoIntoView(isIntersecting = true) {
  act(() => {
    for (const observer of observers) observer.callback([{ isIntersecting }]);
  });
}

function renderDemo() {
  const view = render(
    <InteractiveDemo
      label="Demo repository · acme/platform"
      poster={<svg data-testid="poster" />}
    />,
  );
  const frame = view.container.querySelector<HTMLElement>("[data-demo-status]");
  if (!frame) throw new Error("demo frame not rendered");
  return { ...view, frame };
}

beforeEach(() => {
  observers = [];
  webgl.available = true;
  webgl.probes = 0;
  world.mounts = 0;
  world.crash = false;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InteractiveDemo", () => {
  it("shows the labelled poster and does not load the 3D world before it is near the viewport", () => {
    const { frame } = renderDemo();
    expect(screen.getByTestId("poster")).toBeInTheDocument();
    expect(screen.getByText("Demo repository · acme/platform")).toBeInTheDocument();
    expect(frame).toHaveAttribute("data-demo-status", "idle");
    expect(world.mounts).toBe(0);
    expect(observers[0]?.options?.rootMargin).toBeTruthy();
  });

  it("starts the world when scrolled near and cross-fades once it has drawn", async () => {
    const user = userEvent.setup();
    const { frame } = renderDemo();
    scrollDemoIntoView();

    expect(frame).toHaveAttribute("data-demo-status", "loading");
    expect(screen.getByRole("status")).toHaveTextContent(/starting the 3d engine/i);
    const worldElement = await screen.findByTestId("world");
    expect(worldElement).toHaveAttribute("data-visible", "true");

    await user.click(screen.getByRole("button", { name: /simulate first frame/i }));
    expect(frame).toHaveAttribute("data-demo-status", "ready");
    // The poster is hidden from assistive technology once the live world is shown.
    expect(screen.getByTestId("poster").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("tells the world when it scrolls away so it can pause", async () => {
    renderDemo();
    scrollDemoIntoView();
    await screen.findByTestId("world");
    scrollDemoIntoView(false);
    expect(screen.getByTestId("world")).toHaveAttribute("data-visible", "false");
  });

  it("keeps the poster and explains why when WebGL is unavailable", () => {
    webgl.available = false;
    const { frame } = renderDemo();
    scrollDemoIntoView();
    expect(frame).toHaveAttribute("data-demo-status", "unsupported");
    expect(screen.getByRole("status")).toHaveTextContent(/webgl isn't available/i);
    expect(screen.getByTestId("poster")).toBeVisible();
    expect(world.mounts).toBe(0);
  });

  it("falls back to the poster when the world reports a failure", async () => {
    const user = userEvent.setup();
    const { frame } = renderDemo();
    scrollDemoIntoView();
    await user.click(await screen.findByRole("button", { name: /simulate layout failure/i }));
    expect(frame).toHaveAttribute("data-demo-status", "failed");
    expect(screen.queryByTestId("world")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't start/i);
  });

  it("contains a crashing world instead of breaking the page", async () => {
    world.crash = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { frame } = renderDemo();
    scrollDemoIntoView();
    await vi.waitFor(() => expect(frame).toHaveAttribute("data-demo-status", "failed"));
    expect(screen.getByTestId("poster")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("gives up and keeps the poster if the world never draws", async () => {
    vi.useFakeTimers();
    try {
      const { frame } = renderDemo();
      scrollDemoIntoView();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(frame).toHaveAttribute("data-demo-status", "failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("probes WebGL and activates only once, even when it re-enters the viewport", async () => {
    const { frame } = renderDemo();
    scrollDemoIntoView();
    await screen.findByTestId("world");
    scrollDemoIntoView(false);
    scrollDemoIntoView(true);
    expect(webgl.probes).toBe(1);
    expect(screen.getAllByTestId("world")).toHaveLength(1);
    expect(frame).toHaveAttribute("data-demo-status", "loading");
  });
});
