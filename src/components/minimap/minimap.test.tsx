// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_VERSION, type WorldLayout } from "@/engine/layout/types";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { buildGraphIndex } from "@/graph/model/graph-index";
import { useExplorerStore } from "@/state/explorer-store";
import { Minimap } from "./minimap";
import {
  buildingEmphasis,
  drawStaticLayer,
  MINIMAP_COLORS,
  selectionTarget,
  type MinimapCanvasContext,
} from "./minimap-draw";
import { createMinimapTransform } from "./minimap-geometry";

/** Simple deterministic layout: directories side by side, files in a grid inside each. */
function gridLayout(): WorldLayout {
  const directories = mockRepositoryGraph.directories;
  let topLevel = 0;
  let nested = 0;
  const districts = directories.map((directory) => {
    const base = { id: directory.id, baseY: 0, height: 1, level: directory.depth, labelSize: 2 };
    if (directory.depth === 0) return { ...base, x: 0, z: 0, width: 200, depth: 200 };
    if (directory.depth === 1) {
      const k = topLevel++;
      return {
        ...base,
        x: -75 + (k % 4) * 50,
        z: -75 + Math.floor(k / 4) * 50,
        width: 45,
        depth: 45,
      };
    }
    const k = nested++;
    return {
      ...base,
      x: -90 + (k % 10) * 12,
      z: 20 + Math.floor(k / 10) * 12,
      width: 10,
      depth: 10,
    };
  });
  const buildings = mockRepositoryGraph.files.map((file, i) => ({
    id: file.id,
    districtId: file.directoryId,
    x: -90 + (i % 12) * 15,
    z: 40 + Math.floor(i / 12) * 15,
    width: 4,
    depth: 4,
    height: 5,
    baseY: 1,
  }));
  return {
    version: LAYOUT_VERSION,
    key: "test",
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100, maxY: 10, size: 200 },
    districts,
    buildings,
    durationMs: 0,
  };
}

interface Recorded {
  op: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
}

function recordingContext(): MinimapCanvasContext & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const context = {
    calls,
    fillStyle: "" as MinimapCanvasContext["fillStyle"],
    strokeStyle: "" as MinimapCanvasContext["strokeStyle"],
    lineWidth: 1,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    measureText: (text: string) => ({ width: text.length * 5 }),
  };
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle });
    };
  return Object.assign(context, {
    setTransform: record("setTransform"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    fillText: record("fillText"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    drawImage: record("drawImage"),
  });
}

const index = buildGraphIndex(mockRepositoryGraph);

describe("minimap drawing", () => {
  it("draws districts, buildings, labels and the selection in flare", () => {
    const layout = gridLayout();
    const ctx = recordingContext();
    drawStaticLayer(
      ctx,
      {
        layout,
        transform: createMinimapTransform(layout.bounds, 200, 8),
        index,
        selection: { kind: "file", id: "file:src/auth/jwt.ts" },
        focusedDirectoryId: "dir:src",
        visualMode: "architecture",
        activeContributorId: null,
      },
      2,
    );
    expect(ctx.calls[0]).toMatchObject({ op: "setTransform", args: [2, 0, 0, 2, 0, 0] });
    const fills = ctx.calls.filter((call) => call.op === "fillRect");
    // Background + every district + every building (+ label backgrounds + selection).
    expect(fills.length).toBeGreaterThanOrEqual(
      1 + layout.districts.length + layout.buildings.length,
    );
    expect(fills.some((call) => call.fillStyle === MINIMAP_COLORS.selection)).toBe(true);
    expect(
      ctx.calls.some(
        (call) => call.op === "strokeRect" && call.strokeStyle === MINIMAP_COLORS.focus,
      ),
    ).toBe(true);
    const labels = ctx.calls.filter((call) => call.op === "fillText").map((call) => call.args[0]);
    expect(labels).toEqual(expect.arrayContaining(["src", "docs"]));
  });

  it("draws hidden characters in district labels as visible code points", () => {
    const rlo = String.fromCodePoint(0x202e);
    const spoofed = buildGraphIndex({
      ...mockRepositoryGraph,
      directories: mockRepositoryGraph.directories.map((directory) =>
        directory.id === "dir:docs" ? { ...directory, name: `do${rlo}cs` } : directory,
      ),
    });
    const layout = gridLayout();
    const ctx = recordingContext();
    drawStaticLayer(
      ctx,
      {
        layout,
        transform: createMinimapTransform(layout.bounds, 2000, 8),
        index: spoofed,
        selection: null,
        focusedDirectoryId: null,
        visualMode: "architecture",
        activeContributorId: null,
      },
      1,
    );
    const labels = ctx.calls.filter((call) => call.op === "fillText").map((call) => call.args[0]);
    expect(labels).toContain("do[U+202E]cs");
    expect(labels.some((label) => String(label).includes(rlo))).toBe(false);
  });

  it("maps selections of symbols to their file's building", () => {
    expect(
      selectionTarget({ kind: "symbol", id: "sym:src/auth/jwt.ts#signToken@22" }, index),
    ).toEqual({
      kind: "building",
      id: "file:src/auth/jwt.ts",
    });
    expect(selectionTarget({ kind: "directory", id: "dir:src" }, index)).toEqual({
      kind: "district",
      id: "dir:src",
    });
    expect(selectionTarget(null, index)).toBeNull();
  });

  it("emphasizes the active contributor's files in contributors mode", () => {
    const jwt = index.filesById.get("file:src/auth/jwt.ts");
    const stripe = index.filesById.get("file:src/payments/stripe.ts");
    expect(buildingEmphasis(jwt, index, "contributors", "user:octo-ada")).toBe(1);
    expect(buildingEmphasis(stripe, index, "contributors", "user:octo-ada")).toBeLessThan(0.2);
    expect(buildingEmphasis(jwt, index, "activity", null)).toBeGreaterThan(
      buildingEmphasis(index.filesById.get("file:README.md"), index, "activity", null),
    );
  });

  it("does not darken the map for a contributor with no touched files in the window", () => {
    const [ada] = mockRepositoryGraph.contributors;
    if (!ada) throw new Error("fixture has contributors");
    const quietIndex = buildGraphIndex({
      ...mockRepositoryGraph,
      contributors: [
        ...mockRepositoryGraph.contributors,
        { ...ada, id: "user:quiet", name: "Quiet", commitCount: 0, fileIds: [] },
      ],
    });
    const jwt = quietIndex.filesById.get("file:src/auth/jwt.ts");
    expect(buildingEmphasis(jwt, quietIndex, "contributors", "user:quiet")).toBe(
      buildingEmphasis(jwt, quietIndex, "contributors", null),
    );
  });
});

describe("Minimap", () => {
  let contexts: ReturnType<typeof recordingContext>[];

  beforeEach(() => {
    useExplorerStore.getState().reset();
    contexts = [];
    // Like browsers, return the same context for repeated calls on one canvas.
    const byCanvas = new WeakMap<HTMLCanvasElement, ReturnType<typeof recordingContext>>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      let ctx = byCanvas.get(this);
      if (!ctx) {
        ctx = recordingContext();
        byCanvas.set(this, ctx);
        contexts.push(ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function mount() {
    act(() => {
      useExplorerStore.getState().loadGraph(mockRepositoryGraph);
      useExplorerStore.getState().setLayout(gridLayout());
    });
    return render(<Minimap />);
  }

  it("renders nothing without a layout", () => {
    act(() => useExplorerStore.getState().loadGraph(mockRepositoryGraph));
    const { container } = render(<Minimap />);
    expect(container).toBeEmptyDOMElement();
  });

  it("flies the camera to the clicked point", () => {
    mount();
    const canvas = screen.getByRole("application", { name: /Repository map/ });
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    const command = useExplorerStore.getState().cameraCommand;
    expect(command).toMatchObject({ type: "focus-point" });
    if (command?.type === "focus-point") {
      expect(command.x).toBeCloseTo(0, 6);
      expect(command.z).toBeCloseTo(0, 6);
    }
  });

  it("pans with the arrow keys and recentres with Enter", async () => {
    const user = userEvent.setup();
    mount();
    act(() =>
      useExplorerStore.getState().setCameraPose({ position: [0, 50, 50], target: [10, 0, 10] }),
    );
    const canvas = screen.getByRole("application", { name: /Repository map/ });
    canvas.focus();
    await user.keyboard("{ArrowUp}");
    expect(useExplorerStore.getState().cameraCommand).toMatchObject({
      type: "focus-point",
      x: 10,
      z: 10 - 200 * 0.08,
    });
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useExplorerStore.getState().cameraCommand).toMatchObject({
      type: "focus-point",
      x: 10 + 200 * 0.2,
      z: 10,
    });
    await user.keyboard("{Enter}");
    expect(useExplorerStore.getState().cameraCommand).toMatchObject({ type: "focus-repository" });
  });

  it("redraws the camera layer from store updates at most every 100 ms", () => {
    vi.useFakeTimers();
    mount();
    const visible = contexts.find((ctx) => ctx.calls.some((call) => call.op === "drawImage"));
    expect(visible).toBeDefined();
    if (!visible) return;
    const dynamicDraws = () => visible.calls.filter((call) => call.op === "drawImage").length;
    const before = dynamicDraws();
    act(() => {
      for (let i = 0; i < 20; i += 1)
        useExplorerStore.getState().setCameraPose({ position: [i, 50, 50], target: [0, 0, 0] });
    });
    expect(dynamicDraws()).toBe(before);
    act(() => vi.advanceTimersByTime(120));
    expect(dynamicDraws()).toBe(before + 1);
    // The camera wedge and position dot were drawn.
    expect(visible.calls.some((call) => call.op === "arc")).toBe(true);
  });

  it("collapses and expands", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Collapse map" }));
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show repository map" }));
    expect(screen.getByRole("application", { name: /Repository map/ })).toBeInTheDocument();
  });
});
