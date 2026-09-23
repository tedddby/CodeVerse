import { beforeEach, describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { selectHasBlockingOverlay, selectSelectedFile, useExplorerStore } from "./explorer-store";

const store = () => useExplorerStore.getState();
const authFile = { kind: "file" as const, id: "file:src/auth/auth.ts" };

describe("explorer store", () => {
  beforeEach(() => {
    store().reset();
    store().loadGraph(mockRepositoryGraph);
  });

  it("indexes a loaded graph", () => {
    expect(store().index?.filesById.size).toBe(mockRepositoryGraph.files.length);
  });

  it("ignores selections that do not exist in the graph", () => {
    store().select({ kind: "file", id: "file:does/not/exist.ts" });
    expect(store().selection).toBeNull();
    store().select(authFile);
    expect(selectSelectedFile(store())?.path).toBe("src/auth/auth.ts");
  });

  it("issues a focus command when selecting with focus", () => {
    store().select(authFile, { focus: true });
    expect(store().cameraCommand).toMatchObject({ type: "focus-node", ref: authFile });
  });

  it("gives every camera command a fresh nonce", () => {
    store().issueCameraCommand({ type: "reset" });
    const first = store().cameraCommand?.nonce ?? 0;
    store().issueCameraCommand({ type: "reset" });
    expect(store().cameraCommand?.nonce).toBeGreaterThan(first);
  });

  describe("dependency lines", () => {
    it("are switched on by Dependencies mode and leave with it", () => {
      store().setVisualMode("dependencies");
      expect(store().showDependencies).toBe(true);
      store().setVisualMode("activity");
      expect(store().showDependencies).toBe(false);
    });

    it("stay on when the user enabled them before entering the mode", () => {
      store().toggleDependencies(true);
      store().setVisualMode("dependencies");
      store().setVisualMode("architecture");
      expect(store().showDependencies).toBe(true);
    });

    it("stay on when the user re-enabled them while in the mode", () => {
      store().setVisualMode("dependencies");
      store().toggleDependencies(false);
      store().toggleDependencies(true);
      store().setVisualMode("complexity");
      expect(store().showDependencies).toBe(true);
    });
  });

  it("opens the matching tools when entering activity or contributors mode", () => {
    store().setVisualMode("activity");
    expect(store().timeline.active).toBe(true);
    store().setVisualMode("contributors");
    expect(store().panels.contributors).toBe(true);
  });

  it("switches to contributors mode when a contributor is chosen", () => {
    store().setActiveContributor("user:octo-ada");
    expect(store().visualMode).toBe("contributors");
  });

  it("only opens the code viewer for files in the graph", () => {
    store().openCodeViewer({ fileId: "file:nope.ts" });
    expect(store().codeViewer).toBeNull();
    store().openCodeViewer({ fileId: authFile.id, line: 44 });
    expect(store().codeViewer).toEqual({ fileId: authFile.id, line: 44 });
    expect(selectHasBlockingOverlay(store())).toBe(true);
  });

  it("keeps a still-valid selection when the same repository is reloaded", () => {
    store().select(authFile);
    store().loadGraph(mockRepositoryGraph);
    expect(store().selection).toEqual(authFile);
  });

  it("clears repository state on reset", () => {
    store().select(authFile);
    store().setVisualMode("dependencies");
    store().reset();
    expect(store()).toMatchObject({
      graph: null,
      selection: null,
      visualMode: "architecture",
      showDependencies: false,
      dependenciesFromMode: false,
    });
  });
});
