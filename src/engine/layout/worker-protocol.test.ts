import { describe, expect, it, vi } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { computeWorldLayout } from "./compute-layout";
import { toLayoutInput } from "./layout-input";
import { withoutDuration } from "./test-support";
import {
  handleLayoutWorkerMessage,
  isLayoutGraphInput,
  isLayoutWorkerResponse,
} from "./worker-protocol";

describe("handleLayoutWorkerMessage", () => {
  it("computes a layout for a valid request and echoes the request id", () => {
    const response = handleLayoutWorkerMessage({
      type: "compute",
      requestId: 7,
      graph: toLayoutInput(mockRepositoryGraph),
    });
    expect(response?.type).toBe("result");
    if (response?.type !== "result") return;
    expect(response.requestId).toBe(7);
    expect(withoutDuration(response.layout)).toEqual(
      withoutDuration(computeWorldLayout(mockRepositoryGraph)),
    );
  });

  it("survives a structured-clone round trip, as in a real worker", () => {
    const message = structuredClone({
      type: "compute",
      requestId: 1,
      graph: toLayoutInput(mockRepositoryGraph),
    });
    const response = structuredClone(handleLayoutWorkerMessage(message));
    expect(isLayoutWorkerResponse(response)).toBe(true);
    expect(response?.type).toBe("result");
  });

  it("passes only numeric options to the layout", () => {
    const compute = vi.fn(computeWorldLayout);
    handleLayoutWorkerMessage(
      {
        type: "compute",
        requestId: 2,
        graph: toLayoutInput(mockRepositoryGraph),
        options: { districtPadding: 3, buildingGap: "wide", unknown: 1 },
      },
      compute,
    );
    expect(compute).toHaveBeenCalledWith(expect.anything(), { districtPadding: 3 });
  });

  it("answers malformed graphs with an error for the same request", () => {
    expect(handleLayoutWorkerMessage({ type: "compute", requestId: 3, graph: {} })).toEqual({
      type: "error",
      requestId: 3,
      message: "Layout request did not contain a valid graph",
    });
    const badFiles = { ...toLayoutInput(mockRepositoryGraph), files: [{ id: 1 }] };
    expect(
      handleLayoutWorkerMessage({ type: "compute", requestId: 4, graph: badFiles })?.type,
    ).toBe("error");
  });

  it("reports failures thrown by the layout computation", () => {
    const response = handleLayoutWorkerMessage(
      { type: "compute", requestId: 5, graph: toLayoutInput(mockRepositoryGraph) },
      () => {
        throw new Error("boom");
      },
    );
    expect(response).toEqual({ type: "error", requestId: 5, message: "boom" });
  });

  it("ignores messages that are not layout requests", () => {
    expect(handleLayoutWorkerMessage(null)).toBeNull();
    expect(handleLayoutWorkerMessage("compute")).toBeNull();
    expect(handleLayoutWorkerMessage({ type: "ping", requestId: 1 })).toBeNull();
    expect(handleLayoutWorkerMessage({ type: "compute", requestId: "1" })).toBeNull();
    expect(handleLayoutWorkerMessage({ type: "compute", requestId: 1.5 })).toBeNull();
  });
});

describe("protocol guards", () => {
  it("recognizes valid graphs, including full repository graphs", () => {
    expect(isLayoutGraphInput(mockRepositoryGraph)).toBe(true);
    expect(isLayoutGraphInput(toLayoutInput(mockRepositoryGraph))).toBe(true);
    expect(isLayoutGraphInput({ ...toLayoutInput(mockRepositoryGraph), repository: null })).toBe(
      false,
    );
  });

  it("recognizes responses", () => {
    expect(isLayoutWorkerResponse({ type: "error", requestId: 1, message: "x" })).toBe(true);
    expect(isLayoutWorkerResponse({ type: "result", requestId: 1, layout: {} })).toBe(true);
    expect(isLayoutWorkerResponse({ type: "result", requestId: 1 })).toBe(false);
    expect(isLayoutWorkerResponse({ type: "error", message: "x" })).toBe(false);
  });
});
