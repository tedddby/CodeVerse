// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "@/state/explorer-store";
import { loadMockGraph } from "./test-utils";
import { WorldViewport } from "./world-viewport";

// jsdom has no WebGL: the renderer itself is replaced.
vi.mock("@/engine/rendering/universe-canvas", () => ({
  default: () => <canvas data-testid="universe-canvas" />,
}));

beforeEach(() => {
  loadMockGraph();
  useExplorerStore.setState({ webglAvailable: true });
});

afterEach(() => cleanup());

describe("WorldViewport", () => {
  it("draws the keyboard focus ring on an overlay above the canvas", async () => {
    render(<WorldViewport phase="explorer" fullName="codeverse-demo/acme-platform" />);
    const map = screen.getByRole("application", {
      name: "Interactive 3D map of codeverse-demo/acme-platform",
    });
    await screen.findByTestId("universe-canvas");
    expect(map).toHaveAttribute("tabindex", "0");
    // The canvas's positioned wrappers would paint over an outline on the map itself.
    expect(map).toHaveClass("focus-visible:outline-none");
    expect(map).toHaveClass(
      "after:pointer-events-none",
      "after:absolute",
      "after:inset-0",
      "after:z-10",
      "focus-visible:after:ring-2",
      "focus-visible:after:ring-inset",
      "focus-visible:after:ring-signal",
    );
    expect(map).toHaveAccessibleDescription(/Press G to fly with W, A, S, D or the arrow keys/);
  });

  it("is not focusable behind the loading screen", () => {
    const { container } = render(
      <WorldViewport phase="loading" fullName="codeverse-demo/acme-platform" />,
    );
    const preview = container.firstElementChild;
    expect(preview).toHaveAttribute("tabindex", "-1");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });
});
