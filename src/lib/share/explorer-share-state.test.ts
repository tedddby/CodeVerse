import { beforeEach, describe, expect, it } from "vitest";
import { fileRef, loadMockGraph, resetExplorerStore } from "@/components/explorer/test-utils";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { useExplorerStore } from "@/state/explorer-store";
import { applyShareState, captureShareState, hasViewState, socialImagePath } from "./explorer-share-state";
import { decodeShareState, encodeShareState } from "./url-state";

const allOptions = { includeCamera: true, includeSelection: true, pinCommit: false };

beforeEach(() => {
  loadMockGraph();
});

describe("captureShareState", () => {
  it("captures nothing for the default view", () => {
    expect(captureShareState(useExplorerStore.getState(), allOptions)).toEqual({});
  });

  it("captures mode, selection, camera, navigation, contributor and timeline", () => {
    const store = useExplorerStore.getState();
    store.select(fileRef("src/auth/auth.ts"));
    store.setVisualMode("activity");
    store.setNavigationMode("explore");
    store.setTimeline({ cursor: 1_700_000_000_123.4 });
    store.setCameraPose({ position: [1, 2, 3], target: [4, 5, 6] });
    const share = captureShareState(useExplorerStore.getState(), allOptions);
    expect(share).toEqual({
      mode: "activity",
      selection: fileRef("src/auth/auth.ts"),
      nav: "explore",
      t: 1_700_000_000_123,
      camera: { position: [1, 2, 3], target: [4, 5, 6] },
    });
  });

  it("records dependency lines only when they differ from the mode default", () => {
    const store = useExplorerStore.getState();
    store.setVisualMode("dependencies");
    expect(captureShareState(useExplorerStore.getState(), allOptions).deps).toBeUndefined();
    store.toggleDependencies(false);
    expect(captureShareState(useExplorerStore.getState(), allOptions).deps).toBe(false);
    store.setVisualMode("architecture");
    store.toggleDependencies(true);
    expect(captureShareState(useExplorerStore.getState(), allOptions).deps).toBe(true);
  });

  it("respects the include options and pins the analysed commit", () => {
    const store = useExplorerStore.getState();
    store.select(fileRef("src/index.ts"));
    store.setCameraPose({ position: [1, 2, 3], target: [0, 0, 0] });
    const share = captureShareState(useExplorerStore.getState(), {
      includeCamera: false,
      includeSelection: false,
      pinCommit: true,
      requestedRef: "main",
    });
    expect(share).toEqual({ ref: mockRepositoryGraph.repository.commitSha });
    expect(captureShareState(useExplorerStore.getState(), { ...allOptions, includeCamera: false, includeSelection: false, requestedRef: "develop" })).toEqual({
      ref: "develop",
    });
  });
});

describe("applyShareState", () => {
  it("restores a captured view through a URL round-trip", () => {
    const store = useExplorerStore.getState();
    const contributorId = mockRepositoryGraph.contributors[1]?.id ?? "";
    store.setActiveContributor(contributorId);
    store.select(fileRef("src/payments/stripe.ts"));
    store.toggleDependencies(true);
    store.setCameraPose({ position: [10, 20, 30], target: [1, 2, 3] });
    const url = encodeShareState(captureShareState(useExplorerStore.getState(), allOptions));

    loadMockGraph();
    applyShareState(useExplorerStore.getState(), decodeShareState(url), { worldEnabled: true });
    const restored = useExplorerStore.getState();
    expect(restored.activeContributorId).toBe(contributorId);
    expect(restored.visualMode).toBe("contributors");
    expect(restored.selection).toEqual(fileRef("src/payments/stripe.ts"));
    expect(restored.showDependencies).toBe(true);
    expect(restored.cameraCommand).toMatchObject({
      type: "set-pose",
      animate: false,
      pose: { position: [10, 20, 30], target: [1, 2, 3] },
    });
  });

  it("lets an explicit mode override the contributor's implied mode and applies the timeline", () => {
    applyShareState(
      useExplorerStore.getState(),
      { contributor: mockRepositoryGraph.contributors[0]?.id, mode: "complexity", t: 1_700_000_000_000 },
      { worldEnabled: true },
    );
    const state = useExplorerStore.getState();
    expect(state.visualMode).toBe("complexity");
    expect(state.timeline).toMatchObject({ active: true, cursor: 1_700_000_000_000 });
  });

  it("round-trips the timeline in the mode it was shared in", () => {
    const store = useExplorerStore.getState();
    store.setTimeline({ active: true, cursor: 1_700_000_000_000 });
    expect(captureShareState(useExplorerStore.getState(), allOptions)).toEqual({ mode: "activity", t: 1_700_000_000_000 });

    // The user may switch mode while the timeline stays open; the link names that mode.
    store.setVisualMode("architecture");
    const url = encodeShareState(captureShareState(useExplorerStore.getState(), allOptions));
    loadMockGraph();
    applyShareState(useExplorerStore.getState(), decodeShareState(url), { worldEnabled: true });
    expect(useExplorerStore.getState()).toMatchObject({
      visualMode: "architecture",
      timeline: { active: true, cursor: 1_700_000_000_000 },
    });

    loadMockGraph();
    applyShareState(useExplorerStore.getState(), { t: 1_700_000_000_000 }, { worldEnabled: true });
    expect(useExplorerStore.getState().visualMode).toBe("activity");
  });

  it("ignores nodes and contributors that do not exist in the graph", () => {
    applyShareState(
      useExplorerStore.getState(),
      { selection: fileRef("src/does-not-exist.ts"), contributor: "user:nobody" },
      { worldEnabled: true },
    );
    const state = useExplorerStore.getState();
    expect(state.selection).toBeNull();
    expect(state.activeContributorId).toBeNull();
  });

  it("skips camera and navigation when the 3D world is unavailable", () => {
    applyShareState(
      useExplorerStore.getState(),
      { camera: { position: [1, 1, 1], target: [0, 0, 0] }, nav: "explore" },
      { worldEnabled: false },
    );
    expect(useExplorerStore.getState().cameraCommand).toBeNull();
    expect(useExplorerStore.getState().navigationMode).toBe("orbit");
  });
});

describe("helpers", () => {
  it("detects whether a share state carries view state", () => {
    expect(hasViewState({})).toBe(false);
    expect(hasViewState({ ref: "main" })).toBe(false);
    expect(hasViewState({ deps: false })).toBe(true);
  });

  it("points at the per-repository social image route", () => {
    resetExplorerStore();
    expect(socialImagePath("vercel", "next.js")).toBe("/explore/vercel/next.js/opengraph-image");
  });
});
