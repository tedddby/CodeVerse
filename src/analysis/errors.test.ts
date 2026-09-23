import { describe, expect, it } from "vitest";
import { SourceError, type SourceErrorCode } from "@/sources/types";
import { AnalysisBusyError } from "./concurrency";
import { BUSY_COPY, errorPayloadFor, toErrorPayload } from "./errors";
import { ERROR_COPY, type AnalysisErrorCode } from "./protocol";

describe("toErrorPayload", () => {
  const mapping: Array<[SourceErrorCode, AnalysisErrorCode]> = [
    ["INVALID_REPOSITORY", "INVALID_REPOSITORY"],
    ["NOT_FOUND", "NOT_FOUND"],
    ["PRIVATE_OR_INACCESSIBLE", "PRIVATE_OR_INACCESSIBLE"],
    ["UNAUTHORIZED", "UNAUTHORIZED"],
    ["EMPTY_REPOSITORY", "EMPTY_REPOSITORY"],
    ["REF_NOT_FOUND", "REF_NOT_FOUND"],
    ["UPSTREAM_ERROR", "UPSTREAM_ERROR"],
    ["TIMEOUT", "TIMEOUT"],
    ["INVALID_RESPONSE", "UPSTREAM_ERROR"],
    ["ABORTED", "TIMEOUT"],
  ];

  it.each(mapping)("maps %s to %s with the canonical copy", (sourceCode, code) => {
    const payload = toErrorPayload(new SourceError(sourceCode, "provider detail ghp_secret123"));
    expect(payload).toEqual({ code, ...ERROR_COPY[code] });
  });

  it("uses server-side copy for network failures", () => {
    const payload = toErrorPayload(new SourceError("NETWORK_ERROR", "ECONNRESET"));
    expect(payload.code).toBe("NETWORK_ERROR");
    expect(payload.title).toBe("Couldn't reach GitHub.");
    expect(payload.message).not.toMatch(/your connection/);
  });

  it("carries the retry time of rate limits, normalized", () => {
    expect(
      toErrorPayload(new SourceError("RATE_LIMITED", "x", { retryAt: "2026-09-23T13:00:00Z" })),
    ).toEqual({
      code: "RATE_LIMITED",
      ...ERROR_COPY.RATE_LIMITED,
      retryAt: "2026-09-23T13:00:00.000Z",
    });
    expect(
      toErrorPayload(new SourceError("RATE_LIMITED", "x", { retryAt: "soon" })).retryAt,
    ).toBeUndefined();
    // Only rate limits carry a retry time.
    expect(
      toErrorPayload(new SourceError("NOT_FOUND", "x", { retryAt: "2026-09-23T13:00:00Z" }))
        .retryAt,
    ).toBeUndefined();
  });

  it("hides unknown failures behind INTERNAL", () => {
    for (const error of [
      new Error("database password=hunter2"),
      "string",
      null,
      { code: "NOT_FOUND" },
    ]) {
      expect(toErrorPayload(error)).toEqual({ code: "INTERNAL", ...ERROR_COPY.INTERNAL });
    }
  });

  it("reports a busy server as CLIENT_RATE_LIMITED", () => {
    expect(toErrorPayload(new AnalysisBusyError())).toEqual({
      code: "CLIENT_RATE_LIMITED",
      ...BUSY_COPY,
    });
  });
});

describe("errorPayloadFor", () => {
  it("builds payloads from the canonical copy", () => {
    expect(errorPayloadFor("CLIENT_RATE_LIMITED", "2026-01-01T00:00:00Z")).toEqual({
      code: "CLIENT_RATE_LIMITED",
      ...ERROR_COPY.CLIENT_RATE_LIMITED,
      retryAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
