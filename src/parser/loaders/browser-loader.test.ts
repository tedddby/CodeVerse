import { BrowserGrammarLoader } from "./browser-loader";

function stubFetch(handler: (url: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserGrammarLoader", () => {
  it("fetches binaries from /grammars by default", async () => {
    const fetchMock = stubFetch(() => new Response(Uint8Array.from([0, 97, 115, 109])));
    const loader = new BrowserGrammarLoader();
    const bytes = await loader.loadGrammar("tree-sitter-python.wasm");
    await loader.loadRuntime();
    expect([...bytes]).toEqual([0, 97, 115, 109]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/grammars/tree-sitter-python.wasm",
      "/grammars/web-tree-sitter.wasm",
    ]);
  });

  it("supports a custom base URL (trailing slashes ignored) and caches results", async () => {
    const fetchMock = stubFetch(() => new Response(Uint8Array.from([1])));
    const loader = new BrowserGrammarLoader("https://cdn.example.com/assets/grammars//");
    const first = await loader.loadGrammar("tree-sitter-go.wasm");
    const second = await loader.loadGrammar("tree-sitter-go.wasm");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://cdn.example.com/assets/grammars/tree-sitter-go.wasm",
    );
  });

  it("rejects on HTTP errors and retries on the next call", async () => {
    let status = 404;
    const fetchMock = stubFetch(() =>
      status === 200 ? new Response(Uint8Array.from([5])) : new Response("missing", { status }),
    );
    const loader = new BrowserGrammarLoader();
    await expect(loader.loadGrammar("tree-sitter-rust.wasm")).rejects.toThrow(/HTTP 404/);
    status = 200;
    expect([...(await loader.loadGrammar("tree-sitter-rust.wasm"))]).toEqual([5]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never requests paths outside the grammar directory", async () => {
    const fetchMock = stubFetch(() => new Response(Uint8Array.from([1])));
    const loader = new BrowserGrammarLoader();
    await expect(loader.loadGrammar("../../api/secret.wasm")).rejects.toThrow(/Invalid grammar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
