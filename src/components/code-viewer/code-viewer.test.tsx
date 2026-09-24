// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_ATTRIBUTE } from "@/components/explorer/use-explorer-shortcuts";
import { NARROW_VIEWPORT_QUERY } from "@/components/explorer/use-media-query";
import { SearchPalette } from "@/components/search/search-palette";
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

describe("CodeViewer hidden characters", () => {
  // Built from code points so this file itself contains no invisible characters.
  const RLO = String.fromCodePoint(0x202e);
  const LRI = String.fromCodePoint(0x2066);
  const PDI = String.fromCodePoint(0x2069);
  const ZWSP = String.fromCodePoint(0x200b);
  const BOM = String.fromCodePoint(0xfeff);

  it("warns about Trojan Source bidi controls and shows each one as a visible marker", async () => {
    const content = [
      "export function isAdmin(accessLevel: string) {",
      "  // Trojan Source (CVE-2021-42574)",
      `  if (accessLevel != "user${RLO} ${LRI}// Check if admin${PDI} ${LRI}") {`,
      `    return is${ZWSP}Admin;`,
      "  }",
      "}",
    ].join("\n");
    fetchMock.mockResolvedValue(jsonResponse(sourceBody(content)));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);

    const region = await screen.findByRole("region", { name: "Source code of src/auth/jwt.ts" });
    const notice = screen.getByRole("note");
    expect(notice).toHaveTextContent(
      "This file contains hidden or bidirectional Unicode characters.",
    );
    expect(notice).toHaveTextContent(
      "4 bidirectional formatting characters and 1 invisible character",
    );
    expect(region).toHaveAttribute("aria-describedby", notice.id);

    await waitFor(() =>
      expect(region.querySelector('[data-line="3"] span[style*="color"]')).not.toBeNull(),
    );
    const line = region.querySelector('[data-line="3"]');
    const markers = [...(line?.querySelectorAll("[data-hidden-character]") ?? [])];
    expect(markers.map((marker) => marker.textContent)).toEqual([
      "U+202E",
      "U+2066",
      "U+2069",
      "U+2066",
    ]);
    expect(markers[0]).toHaveAttribute(
      "title",
      "Right-to-left override (U+202E), a hidden character",
    );
    // The controls themselves never reach the DOM, so they cannot reorder the line.
    const text = line?.textContent ?? "";
    expect([RLO, LRI, PDI].filter((control) => text.includes(control))).toEqual([]);
    expect(region.querySelector('[data-line="4"] [data-hidden-character="U+200B"]')).not.toBeNull();
  });

  it("marks hidden characters in lines rendered without highlighting", async () => {
    const neverHighlights: HighlighterLoader = () => new Promise<SourceHighlighter>(() => {});
    fetchMock.mockResolvedValue(jsonResponse(sourceBody(`const role = "user${RLO}";`)));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={neverHighlights} />);
    const region = await screen.findByRole("region", { name: /Source code/ });
    expect(region.querySelector('[data-line="1"] [data-hidden-character="U+202E"]')).not.toBeNull();
    expect(region.textContent).not.toContain(RLO);
  });

  it("does not flag a leading byte order mark or ordinary Unicode", async () => {
    const technologist = String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb);
    const content = `${BOM}const greeting = "héllo wörld";\nconst emoji = "${technologist}";`;
    fetchMock.mockResolvedValue(jsonResponse(sourceBody(content)));
    open({ fileId: "file:src/auth/jwt.ts" });
    render(<CodeViewer loadHighlighter={loadFake} />);
    const region = await screen.findByRole("region", { name: /Source code/ });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(region).not.toHaveAttribute("aria-describedby");
    expect(region.querySelector("[data-hidden-character]")).toBeNull();
    expect(region.querySelector('[data-line="1"]')?.textContent).toBe(
      '1const greeting = "héllo wörld";',
    );
  });

  it("reveals hidden characters in the file path", async () => {
    const graph: RepositoryGraph = {
      ...githubGraph,
      files: githubGraph.files.map((file) =>
        file.id === "file:src/auth/jwt.ts"
          ? { ...file, name: `jwt${RLO}st.ts`, path: `src/auth/jwt${RLO}st.ts` }
          : file,
      ),
    };
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("x")));
    open({ fileId: "file:src/auth/jwt.ts" }, graph);
    render(<CodeViewer loadHighlighter={loadFake} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("jwtU+202Est.ts");
    expect(heading.textContent).not.toContain(RLO);
    expect(heading).toHaveAttribute("title", "src/auth/jwt[U+202E]st.ts");
    expect(
      await screen.findByRole("region", { name: "Source code of src/auth/jwt[U+202E]st.ts" }),
    ).toBeInTheDocument();
  });
});

describe("CodeViewer focus", () => {
  function stubViewport(narrow: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: narrow && query === NARROW_VIEWPORT_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }

  function openJwt() {
    useExplorerStore.getState().openCodeViewer({ fileId: "file:src/auth/jwt.ts" });
  }

  it("returns focus to the button that opened it, after Escape and after the close button", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("const a = 1;")));
    act(() => useExplorerStore.getState().loadGraph(githubGraph));
    render(
      <>
        <button type="button" onClick={openJwt}>
          View source
        </button>
        <CodeViewer loadHighlighter={loadFake} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "View source" });

    opener.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: /jwt\.ts/ });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAttribute("aria-modal", "false");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: /Close source viewer/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("returns focus to the search trigger when opened from the palette with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("const a = 1;")));
    act(() => useExplorerStore.getState().loadGraph(githubGraph));
    render(
      <>
        <button type="button" onClick={() => useExplorerStore.getState().setPanel("search", true)}>
          Search
        </button>
        <SearchPalette />
        <CodeViewer loadHighlighter={loadFake} />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Search" });
    await user.click(trigger);
    await user.type(screen.getByRole("combobox", { name: "Search repository" }), "jwt.ts");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(useExplorerStore.getState().codeViewer?.fileId).toBe("file:src/auth/jwt.ts");
    expect(screen.getByRole("dialog", { name: /jwt\.ts/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().codeViewer).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("falls back to the 3D map when the opener is gone, and leaves focus the user moved alone", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("const a = 1;")));
    act(() => useExplorerStore.getState().loadGraph(githubGraph));
    function TransientOpener() {
      const viewerOpen = useExplorerStore((state) => state.codeViewer !== null);
      return viewerOpen ? null : (
        <button type="button" onClick={openJwt}>
          Transient opener
        </button>
      );
    }
    render(
      <>
        <div {...{ [CANVAS_ATTRIBUTE]: "" }} tabIndex={0} aria-label="3D map" />
        <button type="button">Elsewhere</button>
        <TransientOpener />
        <CodeViewer loadHighlighter={loadFake} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Transient opener" }));
    expect(screen.getByRole("dialog", { name: /jwt\.ts/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("3D map")).toHaveFocus();

    act(openJwt);
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    act(() => useExplorerStore.getState().closeCodeViewer());
    expect(elsewhere).toHaveFocus();
  });

  it("acts as a modal and traps Tab while it covers a narrow screen", async () => {
    const user = userEvent.setup();
    stubViewport(true);
    fetchMock.mockResolvedValue(jsonResponse(sourceBody("const a = 1;", "src/auth/auth.ts")));
    act(() => useExplorerStore.getState().loadGraph(githubGraph));
    render(
      <>
        <button type="button">Behind the viewer</button>
        <CodeViewer loadHighlighter={loadFake} />
      </>,
    );
    act(() => useExplorerStore.getState().openCodeViewer({ fileId: "file:src/auth/auth.ts" }));
    const dialog = screen.getByRole("dialog", { name: /auth\.ts/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: /Close source viewer/ })).toHaveFocus();
    // The lg-only outline is not rendered, so its hidden buttons never become trap stops.
    expect(
      screen.queryByRole("navigation", { name: "Symbols in this file" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /outline/ })).not.toBeInTheDocument();

    const region = await screen.findByRole("region", { name: /Source code/ });
    region.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Copy file contents" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(region).toHaveFocus();
    expect(screen.getByRole("button", { name: "Behind the viewer" })).not.toHaveFocus();
  });
});
