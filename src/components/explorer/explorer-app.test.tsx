// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_COPY, encodeEvent } from "@/analysis/protocol";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { createChunkedResponse, createControlledResponse } from "@/lib/analysis-client/test-helpers";
import type { ShareState } from "@/lib/share/url-state";
import { useExplorerStore } from "@/state/explorer-store";
import { ExplorerApp } from "./explorer-app";
import { fileRef, resetExplorerStore } from "./test-utils";

/**
 * End-to-end orchestration: streamed analysis -> loading experience -> layout
 * -> entrance -> explorer chrome. Only the WebGL renderer, the canvas minimap
 * (jsdom has no GPU/2D canvas) and the text summary (owned and tested
 * elsewhere) are replaced. The layout engine runs for real on the main thread
 * (jsdom has no Worker).
 */

vi.mock("@/engine/rendering/universe-canvas", () => ({
  default: ({ interactive, autoRotate }: { interactive?: boolean; autoRotate?: boolean }) => (
    <div data-testid="universe-canvas" data-interactive={String(interactive)} data-auto-rotate={String(autoRotate)} />
  ),
}));
vi.mock("@/components/minimap/minimap", () => ({ Minimap: () => null }));
vi.mock("@/components/overlays/repository-summary", () => ({
  RepositorySummary: ({ standalone }: { standalone?: boolean }) =>
    standalone ? <article data-testid="summary-standalone" /> : null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/explore/codeverse-demo/acme-platform",
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const OWNER = "codeverse-demo";
const REPO = "acme-platform";

function stubEnvironment({ webgl }: { webgl: boolean }) {
  vi.stubGlobal("fetch", fetchMock);
  // Reduced motion makes the loading hold and the entrance transition instantaneous.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
    webgl && kind === "webgl2" ? { getParameter: () => null, getExtension: () => null } : null) as never);
}

function completeStream() {
  return createChunkedResponse([
    encodeEvent({ type: "stage", stage: "connect", status: "done", message: "Repository found" }),
    encodeEvent({ type: "complete", graph: mockRepositoryGraph }),
  ]);
}

function renderApp(initialShareState: ShareState = {}) {
  return render(<ExplorerApp owner={OWNER} repo={REPO} initialShareState={initialShareState} />);
}

async function waitForExplorer() {
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Explorer tools" })).toBeInTheDocument(), {
    timeout: 5_000,
  });
  await waitFor(() => expect(screen.queryByText("CodeVerse · Mission control")).not.toBeInTheDocument(), { timeout: 5_000 });
}

beforeEach(() => {
  resetExplorerStore();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExplorerApp", () => {
  it("streams the analysis, shows the preview behind the loading screen, then enters the explorer", async () => {
    stubEnvironment({ webgl: true });
    const control = createControlledResponse();
    fetchMock.mockResolvedValue(control.response);
    renderApp();

    expect(screen.getByRole("heading", { name: `${OWNER}/${REPO}` })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Analyzing ${OWNER}/${REPO}`);
    expect(screen.queryByRole("navigation", { name: "Explorer tools" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/analyze/${OWNER}/${REPO}`);

    act(() => {
      control.pushEvent({ type: "stage", stage: "connect", status: "done", message: "Repository found" });
      control.pushEvent({ type: "preview", graph: mockRepositoryGraph });
    });
    expect(await screen.findByText("Repository found")).toBeInTheDocument();
    const preview = await screen.findByTestId("universe-canvas");
    expect(preview).toHaveAttribute("data-interactive", "false");

    act(() => {
      control.pushEvent({ type: "complete", graph: mockRepositoryGraph });
      control.close();
    });
    await waitForExplorer();

    const world = screen.getByRole("application", { name: `Interactive 3D map of ${OWNER}/${REPO}` });
    expect(within(world).getByTestId("universe-canvas")).toHaveAttribute("data-interactive", "true");
    expect(screen.getByRole("group", { name: "Visual mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Parsed \d+ of \d+ files/ })).toBeInTheDocument();
    // Without a shared viewpoint, the camera flies from the backdrop orbit to the overview.
    expect(useExplorerStore.getState().cameraCommand).toMatchObject({ type: "reset" });
    expect(useExplorerStore.getState().layout?.buildings).toHaveLength(mockRepositoryGraph.files.length);
  });

  it("restores shared view state once the explorer opens", async () => {
    stubEnvironment({ webgl: true });
    fetchMock.mockResolvedValue(completeStream());
    renderApp({
      mode: "dependencies",
      selection: fileRef("src/auth/auth.ts"),
      camera: { position: [40, 60, 40], target: [0, 0, 0] },
      ref: "main",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/analyze/${OWNER}/${REPO}?ref=main`);
    await waitForExplorer();
    const state = useExplorerStore.getState();
    expect(state.visualMode).toBe("dependencies");
    expect(state.selection).toEqual(fileRef("src/auth/auth.ts"));
    expect(state.cameraCommand).toMatchObject({ type: "set-pose", animate: false, pose: { position: [40, 60, 40] } });
    expect(within(screen.getByRole("complementary", { name: "Selection details" })).getByText("auth.ts")).toBeInTheDocument();
  });

  it("handles keyboard shortcuts once the explorer is open", async () => {
    stubEnvironment({ webgl: true });
    fetchMock.mockResolvedValue(completeStream());
    renderApp();
    fireEvent.keyDown(document.body, { key: "3" });
    expect(useExplorerStore.getState().visualMode).toBe("architecture"); // not during loading
    await waitForExplorer();
    fireEvent.keyDown(document.body, { key: "3" });
    expect(useExplorerStore.getState().visualMode).toBe("activity");
  });

  it("shows a recoverable error screen and retries", async () => {
    stubEnvironment({ webgl: true });
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        createChunkedResponse([encodeEvent({ type: "error", error: { code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND } })], { status: 404 }),
      )
      .mockResolvedValueOnce(completeStream());
    renderApp();
    expect(await screen.findByRole("heading", { name: "Repository not found." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitForExplorer();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the text summary when WebGL is unavailable", async () => {
    stubEnvironment({ webgl: false });
    fetchMock.mockResolvedValue(completeStream());
    renderApp();
    await waitForExplorer();
    // The standalone text summary (which explains the missing WebGL itself) replaces the world.
    expect(screen.getByTestId("summary-standalone")).toBeInTheDocument();
    expect(screen.queryByTestId("universe-canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Visual mode" })).not.toBeInTheDocument();
    expect(useExplorerStore.getState().webglAvailable).toBe(false);
  });

  it("resets repository state when unmounted", async () => {
    stubEnvironment({ webgl: true });
    fetchMock.mockResolvedValue(completeStream());
    const { unmount } = renderApp();
    await waitForExplorer();
    expect(useExplorerStore.getState().graph).not.toBeNull();
    unmount();
    expect(useExplorerStore.getState().graph).toBeNull();
    expect(useExplorerStore.getState().layout).toBeNull();
  });
});
