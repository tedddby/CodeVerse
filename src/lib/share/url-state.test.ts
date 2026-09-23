import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  decodeShareState,
  encodeCamera,
  encodeShareState,
  MAX_NODE_ID_LENGTH,
  searchParamsFromRecord,
  type ShareState,
} from "./url-state";

const fullState: ShareState = {
  ref: "v18.2.0",
  mode: "dependencies",
  selection: { kind: "file", id: "file:packages/react/src/React.js" },
  deps: false,
  nav: "explore",
  contributor: "user:gaearon",
  t: 1_725_148_800_000,
  camera: { position: [120.5, 80, -42.25], target: [0, 0, 0] },
};

function roundTrip(state: ShareState): ShareState {
  return decodeShareState(new URLSearchParams(encodeShareState(state).toString()));
}

describe("share URL state", () => {
  it("round-trips every field", () => {
    expect(roundTrip(fullState)).toEqual(fullState);
  });

  it("round-trips directory (including the root) and symbol selections", () => {
    expect(roundTrip({ selection: { kind: "directory", id: "dir:src/auth" } }).selection).toEqual({ kind: "directory", id: "dir:src/auth" });
    expect(roundTrip({ selection: { kind: "directory", id: "dir:" } }).selection).toEqual({ kind: "directory", id: "dir:" });
    const symbol = { kind: "symbol", id: "sym:src/auth/auth.ts#authenticate@704" } as const;
    expect(roundTrip({ selection: symbol }).selection).toEqual(symbol);
  });

  it("preserves unusual but valid characters in paths", () => {
    const id = "file:docs/Guide & FAQ (v2)/naïve café #1.md";
    expect(roundTrip({ selection: { kind: "file", id } }).selection?.id).toBe(id);
  });

  it("encodes the camera compactly with two decimals and no negative zero", () => {
    const camera = { position: [1.23456, -0.001, 99.999] as [number, number, number], target: [-5.555, 0, 1e-9] as [number, number, number] };
    expect(encodeCamera(camera)).toBe("1.23,0,100,-5.55,0,0");
    expect(encodeShareState({ camera }).get("cam")).toBe("1.23,0,100,-5.55,0,0");
  });

  it("omits empty state entirely", () => {
    expect(encodeShareState({}).toString()).toBe("");
    expect(decodeShareState(new URLSearchParams())).toEqual({});
  });

  it("builds absolute explorer URLs", () => {
    expect(buildShareUrl("https://codeverse.dev/", "facebook", "react", {})).toBe("https://codeverse.dev/explore/facebook/react");
    expect(buildShareUrl("https://codeverse.dev", "vercel", "next.js", { mode: "activity" })).toBe(
      "https://codeverse.dev/explore/vercel/next.js?mode=activity",
    );
  });

  it("accepts boolean flag spellings", () => {
    expect(decodeShareState(new URLSearchParams("deps=true")).deps).toBe(true);
    expect(decodeShareState(new URLSearchParams("deps=0")).deps).toBe(false);
    expect(decodeShareState(new URLSearchParams("deps=yes")).deps).toBeUndefined();
  });

  it("converts Next.js searchParams records, taking the first of repeated values", () => {
    const params = searchParamsFromRecord({ mode: ["activity", "complexity"], ref: "main", missing: undefined });
    expect(decodeShareState(params)).toEqual({ mode: "activity", ref: "main" });
  });
});

describe("decodeShareState rejects malicious or malformed values", () => {
  const decode = (query: string) => decodeShareState(new URLSearchParams(query));

  it("drops unknown modes and navigation modes", () => {
    expect(decode("mode=matrix&nav=fly")).toEqual({});
    expect(decode("mode=__proto__")).toEqual({});
  });

  it("requires node ids with a known prefix, a path and bounded length", () => {
    expect(decode("sel=javascript:alert(1)").selection).toBeUndefined();
    expect(decode("sel=file:").selection).toBeUndefined();
    expect(decode("sel=sym:noHash").selection).toBeUndefined();
    expect(decode("sel=user:octocat").selection).toBeUndefined();
    expect(decode(`sel=file:${"a".repeat(MAX_NODE_ID_LENGTH)}`).selection).toBeUndefined();
    expect(decode("sel=file:src%00evil.ts").selection).toBeUndefined();
    expect(decode("sel=file:src%0Aevil.ts").selection).toBeUndefined();
  });

  it("rejects non-finite, malformed and out-of-range camera values", () => {
    expect(decode("cam=1,2,3,4,5").camera).toBeUndefined();
    expect(decode("cam=1,2,3,4,5,6,7").camera).toBeUndefined();
    expect(decode("cam=1,2,3,4,5,NaN").camera).toBeUndefined();
    expect(decode("cam=1,2,3,4,5,Infinity").camera).toBeUndefined();
    expect(decode("cam=1,2,3,4,5,1e400").camera).toBeUndefined();
    expect(decode("cam=1,2,3,4,5,2000000").camera).toBeUndefined();
    expect(decode("cam=0x10,2,3,4,5,6").camera).toBeUndefined();
    expect(decode(`cam=${"1".repeat(200)},2,3,4,5,6`).camera).toBeUndefined();
    expect(decode("cam=-1.5,2,3e2,4,5,6").camera).toEqual({ position: [-1.5, 2, 300], target: [4, 5, 6] });
  });

  it("validates refs with the repository ref rules", () => {
    expect(decode("ref=../../etc/passwd").ref).toBeUndefined();
    expect(decode("ref=feature//x").ref).toBeUndefined();
    expect(decode("ref=main;rm -rf").ref).toBeUndefined();
    expect(decode(`ref=${"a".repeat(201)}`).ref).toBeUndefined();
    expect(decode("ref=release/2.0").ref).toBe("release/2.0");
  });

  it("validates contributor ids and timeline instants", () => {
    expect(decode("contributor=<script>").contributor).toBeUndefined();
    expect(decode(`contributor=user:${"x".repeat(300)}`).contributor).toBeUndefined();
    expect(decode("contributor=author:ada lovelace").contributor).toBe("author:ada lovelace");
    expect(decode("t=-5").t).toBeUndefined();
    expect(decode("t=12.5").t).toBeUndefined();
    expect(decode("t=99999999999999999").t).toBeUndefined();
    expect(decode("t=1700000000000").t).toBe(1_700_000_000_000);
  });

  it("keeps the valid parts of a partially tampered link", () => {
    expect(decode("mode=activity&sel=evil&cam=oops&deps=1")).toEqual({ mode: "activity", deps: true });
  });

  it("never encodes invalid values", () => {
    const params = encodeShareState({
      ref: "../x",
      selection: { kind: "file", id: "file:" },
      contributor: "nobody",
      t: Number.NaN,
      camera: { position: [Number.POSITIVE_INFINITY, 0, 0], target: [0, 0, 0] },
    });
    expect(params.toString()).toBe("");
  });
});
