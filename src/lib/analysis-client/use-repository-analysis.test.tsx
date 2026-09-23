// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_COPY, encodeEvent } from "@/analysis/protocol";
import { resetExplorerStore } from "@/components/explorer/test-utils";
import { buildFixtureGraph } from "@/fixtures/fixture-builder";
import { MOCK_REPOSITORY_SPEC, mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { useExplorerStore } from "@/state/explorer-store";
import { createChunkedResponse, createControlledResponse } from "./test-helpers";
import { STREAM_INTERRUPTED_ERROR, useRepositoryAnalysis } from "./use-repository-analysis";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

/** Structure-only preview of the mock repository (same commit, no symbols). */
const previewGraph = buildFixtureGraph({
  ...MOCK_REPOSITORY_SPEC,
  files: MOCK_REPOSITORY_SPEC.files.map(({ path, lines }) => ({ path, lines })),
});

interface AnalysisProps {
  owner: string;
  repo: string;
  ref?: string;
}

beforeEach(() => {
  resetExplorerStore();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAnalysis(input: AnalysisProps = { owner: "codeverse-demo", repo: "acme-platform" }) {
  return renderHook((props: AnalysisProps) => useRepositoryAnalysis(props), { initialProps: input });
}

describe("useRepositoryAnalysis", () => {
  it("requests the analysis stream for the repository and ref", async () => {
    fetchMock.mockResolvedValue(createChunkedResponse([encodeEvent({ type: "complete", graph: mockRepositoryGraph })]));
    renderAnalysis({ owner: "facebook", repo: "react", ref: "v18.2.0" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/analyze/facebook/react?ref=v18.2.0");
    expect(new Headers(init?.headers).get("accept")).toBe("application/x-ndjson");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("streams stages, loads the preview graph, then completes with the final graph", async () => {
    const control = createControlledResponse();
    fetchMock.mockResolvedValue(control.response);
    const { result } = renderAnalysis();
    expect(result.current.status).toBe("loading");
    expect(result.current.stages.connect.status).toBe("pending");

    act(() => {
      control.pushEvent({ type: "stage", stage: "connect", status: "done", message: "Repository found" });
      control.pushEvent({ type: "stage", stage: "tree", status: "warning", message: "Large repository: structure first." });
      control.pushEvent({ type: "stage", stage: "parse", status: "progress", progress: 0.71 });
    });
    await waitFor(() => expect(result.current.stages.parse.progress).toBe(0.71));
    expect(result.current.stages.connect).toMatchObject({ status: "done", message: "Repository found" });
    expect(result.current.warnings).toEqual(["Large repository: structure first."]);

    act(() => control.pushEvent({ type: "preview", graph: previewGraph }));
    await waitFor(() => expect(result.current.status).toBe("preview"));
    expect(useExplorerStore.getState().graph).toBe(result.current.graph);
    expect(useExplorerStore.getState().graph?.symbols).toHaveLength(0);

    act(() => {
      control.pushEvent({ type: "complete", graph: mockRepositoryGraph });
      control.close();
    });
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.graph?.symbols.length).toBeGreaterThan(0);
    expect(useExplorerStore.getState().graph?.symbols).toHaveLength(mockRepositoryGraph.symbols.length);
    expect(useExplorerStore.getState().index?.filesById.size).toBe(mockRepositoryGraph.files.length);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error event from the stream", async () => {
    fetchMock.mockResolvedValue(
      createChunkedResponse([
        encodeEvent({ type: "stage", stage: "connect", status: "start" }),
        encodeEvent({ type: "error", error: { code: "EMPTY_REPOSITORY", ...ERROR_COPY.EMPTY_REPOSITORY } }),
      ]),
    );
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual({ code: "EMPTY_REPOSITORY", ...ERROR_COPY.EMPTY_REPOSITORY });
    expect(useExplorerStore.getState().graph).toBeNull();
  });

  it("reads the error payload from an HTTP error response body", async () => {
    fetchMock.mockResolvedValue(
      createChunkedResponse(
        [encodeEvent({ type: "error", error: { code: "NOT_FOUND", title: "Repository not found.", message: "No repository named acme/nope." } })],
        { status: 404 },
      ),
    );
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual({ code: "NOT_FOUND", title: "Repository not found.", message: "No repository named acme/nope." });
  });

  it("falls back to the HTTP status when the error body is unusable", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502, headers: { "retry-after": "30" } }));
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatchObject({ code: "UPSTREAM_ERROR", title: ERROR_COPY.UPSTREAM_ERROR.title });
    expect(result.current.error?.retryAt).toBeDefined();
  });

  it("reports a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual({ code: "NETWORK_ERROR", ...ERROR_COPY.NETWORK_ERROR });
  });

  it("treats a stream that ends without a terminal event as an error", async () => {
    fetchMock.mockResolvedValue(createChunkedResponse([encodeEvent({ type: "stage", stage: "connect", status: "done" })]));
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual(STREAM_INTERRUPTED_ERROR);
    expect(result.current.stages.connect.status).toBe("done");
  });

  it("treats a connection dropped mid-stream as an error", async () => {
    const control = createControlledResponse();
    fetchMock.mockResolvedValue(control.response);
    const { result } = renderAnalysis();
    act(() => control.pushEvent({ type: "stage", stage: "connect", status: "done" }));
    await waitFor(() => expect(result.current.stages.connect.status).toBe("done"));
    act(() => control.fail());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.code).toBe("NETWORK_ERROR");
  });

  it("aborts the request on unmount and ignores anything that arrives later", async () => {
    const control = createControlledResponse();
    fetchMock.mockResolvedValue(control.response);
    const { unmount } = renderAnalysis();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    control.pushEvent({ type: "complete", graph: mockRepositoryGraph });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useExplorerStore.getState().graph).toBeNull();
  });

  it("restarts with a fresh state when the repository changes", async () => {
    const first = createControlledResponse();
    fetchMock.mockResolvedValueOnce(first.response).mockResolvedValueOnce(createChunkedResponse([encodeEvent({ type: "complete", graph: mockRepositoryGraph })]));
    const { result, rerender } = renderAnalysis();
    act(() => first.pushEvent({ type: "stage", stage: "connect", status: "done" }));
    await waitFor(() => expect(result.current.stages.connect.status).toBe("done"));
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;

    rerender({ owner: "vercel", repo: "next.js" });
    expect(result.current.status).toBe("loading");
    expect(result.current.stages.connect.status).toBe("pending");
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/analyze/vercel/next.js");
  });

  it("retry starts a new request after an error", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(createChunkedResponse([encodeEvent({ type: "complete", graph: mockRepositoryGraph })]));
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("advances the elapsed time while loading and freezes it when finished", async () => {
    const control = createControlledResponse();
    fetchMock.mockResolvedValue(control.response);
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.elapsedMs).toBeGreaterThanOrEqual(100), { timeout: 2_000 });
    act(() => {
      control.pushEvent({ type: "complete", graph: mockRepositoryGraph });
      control.close();
    });
    await waitFor(() => expect(result.current.status).toBe("complete"));
    const frozen = result.current.elapsedMs;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(result.current.elapsedMs).toBe(frozen);
  });
});
