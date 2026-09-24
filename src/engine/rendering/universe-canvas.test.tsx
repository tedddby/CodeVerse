// @vitest-environment jsdom
import type { RootState } from "@react-three/fiber";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { useExplorerStore } from "@/state/explorer-store";
import { CONTEXT_RESTORE_TIMEOUT_MS } from "./context-loss";
import UniverseCanvas, { CANVAS_RESIZE } from "./universe-canvas";

interface CanvasProps {
  resize?: unknown;
  onCreated?: (state: RootState) => void;
  children?: ReactNode;
}

const canvasMock = vi.hoisted(() => ({
  props: null as CanvasProps | null,
  mounts: 0,
}));

// The real <Canvas> needs WebGL; the mock records its props and mounts.
vi.mock("@react-three/fiber", () => ({
  Canvas: (props: CanvasProps) => {
    canvasMock.props = props;
    useEffect(() => {
      canvasMock.mounts += 1;
    }, []);
    return <canvas data-testid="gl-canvas" />;
  },
}));
vi.mock("./universe-scene", () => ({ UniverseScene: () => null }));

/** Plays R3F's onCreated with a fake renderer whose domElement is `element`. */
function createRenderer(element: HTMLCanvasElement): void {
  const gl = { domElement: element } as unknown as RootState["gl"];
  act(() => canvasMock.props?.onCreated?.({ gl } as RootState));
}

describe("UniverseCanvas", () => {
  beforeEach(() => {
    canvasMock.props = null;
    canvasMock.mounts = 0;
    useExplorerStore.setState({ webglAvailable: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sizes the canvas from its layout box, ignoring CSS transforms", () => {
    render(<UniverseCanvas />);
    expect(canvasMock.props?.resize).toBe(CANVAS_RESIZE);
    expect(CANVAS_RESIZE.offsetSize).toBe(true);
  });

  it("shows a status while the context is lost and clears it when restored", () => {
    render(<UniverseCanvas />);
    const element = document.createElement("canvas");
    createRenderer(element);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      element.dispatchEvent(new Event("webglcontextlost"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/3D view paused/);

    act(() => {
      element.dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a reload when the context does not come back, which remounts the canvas", () => {
    vi.useFakeTimers();
    render(<UniverseCanvas />);
    const element = document.createElement("canvas");
    createRenderer(element);
    expect(canvasMock.mounts).toBe(1);

    act(() => {
      element.dispatchEvent(new Event("webglcontextlost"));
    });
    act(() => {
      vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS + 10);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const reload = screen.getByRole("button", { name: "Reload 3D view" });

    fireEvent.click(reload);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(canvasMock.mounts).toBe(2);

    // The old canvas is no longer watched (unmounting force-loses its context).
    act(() => {
      element.dispatchEvent(new Event("webglcontextlost"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops listening after unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<UniverseCanvas />);
    const element = document.createElement("canvas");
    createRenderer(element);
    unmount();
    element.dispatchEvent(new Event("webglcontextlost"));
    vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS + 10);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
