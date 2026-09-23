// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import type { RepositoryGraph } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { CodeViewer } from "./code-viewer";
import type { HighlighterLoader, SourceHighlighter } from "./highlighter";
import { sourceFileCache } from "./source-cache";

const githubGraph: RepositoryGraph = {
  ...mockRepositoryGraph,
  repository: {
    ...mockRepositoryGraph.repository,
    provider: "github",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
  },
};

/** Synchronous fake: every line becomes a single red token. */
const fakeHighlighter: SourceHighlighter = {
  createSession: async () => ({
    tokenizeLines: (lines) => lines.map((line) => [{ content: line, color: "#ff0000" }]),
  }),
};
const loadFake: HighlighterLoader = async () => fakeHighlighter;

function sourceBody(content: string, path = "src/auth/jwt.ts") {
  return {
    path,
    ref: githubGraph.repository.commitSha,
    size: content.length,
    content,
    language: "typescript",
    lines: content.split("\n").length,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function open(
  state: { fileId: string; line?: number; endLine?: number },
  graph: RepositoryGraph = githubGraph,
) {
  act(() => {
    useExplorerStore.getState().loadGraph(graph);
    useExplorerStore.getState().openCodeViewer(state);
  });
}

let fetchMock: ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

beforeEach(() => {
  useExplorerStore.getState().reset();
  sourceFileCache.clear();
  fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CodeViewer", () => {
  it("renders nothing when closed", () => {
    act(() => useExplorerStore.getState().loadGraph(githubGraph));
    const { container } = render(<CodeViewer loadHighlighter={loadFake} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the file at the analysed commit, shows a skeleton, then highlighted code", async () => {
    const content = Array.from({ length: 30 }, (_, i) => `const line${i + 1} = ${i + 1};`).join(
      "\n",
    );
    let resolve: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((done) => (resolve = done)));
    open({ fileId: "file:src/auth/jwt.ts", line: 5, endLine: 7 });
    render(<CodeViewer loadHighlighter={loadFake} />);

    const dialog = screen.getByRole("dialog", { name: /jwt\.ts/ });
    expect(within(dialog).getByRole("status", { name: "Loading source" })).toBeInTheDocument();
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `/api/source/codeverse-demo/acme-platform?ref=${githubGraph.repository.commitSha}&path=src%2Fauth%2Fjwt.ts`,
    );

    await act(async () => resolve(jsonResponse(sourceBody(content))));
    const region = await screen.findByRole("region", { name: "Source code of src/auth/jwt.ts" });
    await waitFor(() =>
      expect(region.querySelector('[data-line="1"] span[style*="color"]')).not.toBeNull(),
    );
    expect(region.querySelector('[data-line="1"]')).toHaveTextContent("const line1 = 1;");

    // Requested range is emphasized; lines outside it are not.
    expect(region.querySelector('[data-line="5"]')?.className).toContain("bg-flare");
    expect(region.querySelector('[data-line="7"]')?.className).toContain("bg-flare");
    expect(region.querySelector('[data-line="8"]')?.className).not.toContain("bg-flare");

    // Header metadata and the GitHub deep link with line anchors.
    expect(within(dialog).getByText("30 lines")).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: /Open on GitHub/ });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/codeverse-demo/acme-platform/blob/${githubGraph.repository.commitSha}/src/auth/jwt.ts#L5-L7`,
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Lines 5–7")).toBeInTheDocument();
  });

  it("virtualizes long files", async () => {
    const content = Array.from({ length: 20_000 }, (_, i) => `line ${i + 1}`).join("\n");
    fetchMock.mockResolvedValue(jsonResponse(sourceBody(content)));
    open({ fileId: "file:src/auth/jwt.ts", line: 15_000 });
    render(<CodeViewer loadHighlighter={loadFake} />);
    const region = await screen.findByRole("region", { name: /Source code/ });
    const rendered = region.querySelectorAll("[data-line]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
    // The requested line is inside the rendered window.
    expect(region.querySelector('[data-line="15000"]')).not.toBeNull();
    expect(region.querySelector('[data-line="1"]')).toBeNull();
  });

  it("shows the API's message for binary files with a GitHub fallback", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "BINARY",
            title: "This is a binary file.",
            message: "Binary files can't be shown.",
          },
        },
        415,
      ),
    );
    open({ fileId: "file:docs/diagrams/overview.png" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    expect(await screen.findByText("This is a binary file.")).toBeInTheDocument();
    expect(screen.getByText("Binary files can't be shown.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/ })).not.toBeInTheDocument();
    const fallback = screen.getAllByRole("link", { name: /Open on GitHub/ });
    expect(fallback.length).toBeGreaterThan(0);
  });

  it("offers a retry for rate limits and recovers", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "RATE_LIMITED",
              title: "Rate limit reached.",
              message: "Try again later.",
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(sourceBody("export const ok = true;")));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit reached.");
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    const region = await screen.findByRole("region", { name: /Source code/ });
    expect(region).toHaveTextContent("export const ok = true;");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    expect(await screen.findByText("Couldn't reach the server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("does not request source for repositories that are not on GitHub", () => {
    open({ fileId: "file:src/auth/jwt.ts" }, mockRepositoryGraph);
    render(<CodeViewer loadHighlighter={loadFake} />);
    expect(screen.getByText("Source isn't available for this repository.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves recently viewed files from the cache", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("const cached = 1;")));
    open({ fileId: "file:src/auth/jwt.ts" });
    const { unmount } = render(<CodeViewer loadHighlighter={loadFake} />);
    await screen.findByRole("region", { name: /Source code/ });
    unmount();
    act(() => useExplorerStore.getState().closeCodeViewer());
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    expect(screen.getByRole("region", { name: /Source code/ })).toHaveTextContent(
      "const cached = 1;",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists the file's symbols and jumps to one when clicked", async () => {
    const user = userEvent.setup();
    const content = Array.from({ length: 842 }, (_, i) => `// ${i + 1}`).join("\n");
    fetchMock.mockResolvedValue(jsonResponse(sourceBody(content, "src/auth/auth.ts")));
    open({ fileId: "file:src/auth/auth.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    const outline = screen.getByRole("navigation", { name: "Symbols in this file" });
    await user.click(within(outline).getByRole("button", { name: /revoke/ }));
    expect(useExplorerStore.getState().codeViewer).toEqual({
      fileId: "file:src/auth/auth.ts",
      line: 194,
      endLine: 260,
    });
    expect(useExplorerStore.getState().selection).toEqual({
      kind: "symbol",
      id: "sym:src/auth/auth.ts#revoke@194",
    });
    expect(within(outline).getByRole("button", { name: /revoke/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
    const region = await screen.findByRole("region", { name: /Source code/ });
    expect(region.querySelector('[data-line="194"]')?.className).toContain("bg-flare");
  });

  it("closes with Escape and with the close button", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("x")));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().codeViewer).toBeNull();

    open({ fileId: "file:src/auth/jwt.ts" });
    await user.click(screen.getByRole("button", { name: /Close source viewer/ }));
    expect(useExplorerStore.getState().codeViewer).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves Escape to the search palette when it is open on top", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("x")));
    open({ fileId: "file:src/auth/jwt.ts" });
    act(() => useExplorerStore.getState().setPanel("search", true));
    render(<CodeViewer loadHighlighter={loadFake} />);
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().codeViewer).not.toBeNull();
  });
});
