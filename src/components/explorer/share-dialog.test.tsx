// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { useExplorerStore } from "@/state/explorer-store";
import { ShareDialog } from "./share-dialog";
import { fileRef, loadMockGraph, selectNode } from "./test-utils";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

function shareUrl(): URL {
  return new URL((screen.getByRole("textbox", { name: "Link" }) as HTMLInputElement).value);
}

beforeEach(() => {
  loadMockGraph();
  selectNode(fileRef("src/auth/auth.ts"));
  const store = useExplorerStore.getState();
  store.setVisualMode("activity");
  store.setCameraPose({ position: [12.345, 50, -8], target: [0, 0, 1.5] });
});

afterEach(() => {
  cleanup();
});

function open() {
  act(() => useExplorerStore.getState().setPanel("share", true));
}

describe("ShareDialog", () => {
  it("renders nothing while closed", () => {
    render(<ShareDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("builds a link that captures the current view and focuses the copy button", () => {
    render(<ShareDialog requestedRef="main" />);
    open();
    expect(screen.getByRole("dialog", { name: "Share this view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveFocus();
    const url = shareUrl();
    expect(url.pathname).toBe("/explore/codeverse-demo/acme-platform");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: "main",
      mode: "activity",
      sel: "file:src/auth/auth.ts",
      cam: "12.35,50,-8,0,0,1.5",
    });
    expect(screen.getByRole("img", { name: /Social preview card/ })).toHaveAttribute(
      "src",
      "/explore/codeverse-demo/acme-platform/opengraph-image",
    );
  });

  it("updates the link when options change, including pinning the commit", async () => {
    const user = userEvent.setup();
    render(<ShareDialog />);
    open();
    await user.click(screen.getByRole("checkbox", { name: /Selection/ }));
    await user.click(screen.getByRole("checkbox", { name: /Camera position/ }));
    expect(Object.fromEntries(shareUrl().searchParams)).toEqual({ mode: "activity" });
    await user.click(screen.getByRole("checkbox", { name: /Pin to this commit/ }));
    expect(shareUrl().searchParams.get("ref")).toBe(mockRepositoryGraph.repository.commitSha);
  });

  it("disables options that have nothing to capture", () => {
    act(() => {
      selectNode(null);
      useExplorerStore.setState({ cameraPose: null });
    });
    render(<ShareDialog />);
    open();
    expect(screen.getByRole("checkbox", { name: /Selection/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Camera position/ })).toBeDisabled();
    expect(shareUrl().search).toBe("?mode=activity");
  });

  it("copies the link and confirms", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);
    render(<ShareDialog />);
    open();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(shareUrl().toString());
    expect(await screen.findByText("Link copied to the clipboard.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("explains when the browser blocks copying", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    render(<ShareDialog />);
    open();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText(/Copy was blocked by the browser/)).toBeInTheDocument();
  });

  it("closes with Escape and the Done button", async () => {
    const user = userEvent.setup();
    render(<ShareDialog />);
    open();
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().panels.share).toBe(false);
    open();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(useExplorerStore.getState().panels.share).toBe(false);
  });
});
