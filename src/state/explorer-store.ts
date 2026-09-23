import { create } from "zustand";
import { buildGraphIndex, type GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef, RepositoryGraph } from "@/graph/model/types";
import type { WorldLayout } from "@/engine/layout/types";

/**
 * Global explorer state.
 *
 * Data flow: graph -> index -> layout -> renderer. UI panels and the camera rig
 * communicate exclusively through this store (no prop drilling across the
 * canvas boundary). High-frequency values (camera pose) are written throttled
 * and read with `useExplorerStore.getState()` to avoid re-rendering React.
 */

export type VisualMode = "architecture" | "dependencies" | "activity" | "contributors" | "complexity";

export const VISUAL_MODES: ReadonlyArray<{ id: VisualMode; label: string; description: string }> = [
  { id: "architecture", label: "Architecture", description: "Directories as districts, files colored by language." },
  { id: "dependencies", label: "Dependencies", description: "Emphasize import relationships between files." },
  { id: "activity", label: "Activity", description: "Brighter buildings changed more recently." },
  { id: "contributors", label: "Contributors", description: "Highlight files touched by a contributor." },
  { id: "complexity", label: "Complexity", description: "Emphasize large files with many symbols and dependencies." },
];

export type NavigationMode = "orbit" | "explore";

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export type CameraCommand =
  /** Return to the initial overview pose. */
  | { type: "reset" }
  /** Frame the whole repository. */
  | { type: "focus-repository" }
  /** Frame the current selection (no-op without selection). */
  | { type: "focus-selected" }
  /** Fly to a directory, file or symbol. */
  | { type: "focus-node"; ref: NodeRef }
  /** Fly to a ground point (e.g. minimap click), keeping the current viewing angle. */
  | { type: "focus-point"; x: number; z: number }
  /** Jump/fly to an exact pose (e.g. restored from a share link). */
  | { type: "set-pose"; pose: CameraPose; animate: boolean };

export type PanelId = "search" | "analytics" | "contributors" | "shortcuts" | "share" | "summary";

export interface TimelineState {
  /** Whether the history timeline is shown and drives highlighting. */
  active: boolean;
  /** Selected instant (epoch ms); null = latest. */
  cursor: number | null;
  /** Width of the highlighted period ending at `cursor`, in days. */
  windowDays: number;
}

export interface CodeViewerState {
  fileId: string;
  /** Line to scroll to and highlight (1-based). */
  line?: number;
  /** Optional highlighted range end (inclusive). */
  endLine?: number;
}

export interface ExplorerState {
  graph: RepositoryGraph | null;
  index: GraphIndex | null;
  layout: WorldLayout | null;

  selection: NodeRef | null;
  hovered: NodeRef | null;
  /** Directory the user "entered"; other districts are de-emphasized. */
  focusedDirectoryId: string | null;

  visualMode: VisualMode;
  showDependencies: boolean;
  navigationMode: NavigationMode;
  timeline: TimelineState;
  activeContributorId: string | null;

  panels: Record<PanelId, boolean>;
  codeViewer: CodeViewerState | null;

  cameraCommand: (CameraCommand & { nonce: number }) | null;
  /** Last reported camera pose (throttled). Read via getState() in non-React code. */
  cameraPose: CameraPose | null;

  reducedMotion: boolean;
  /** null until detected on the client. */
  webglAvailable: boolean | null;

  loadGraph: (graph: RepositoryGraph) => void;
  setLayout: (layout: WorldLayout | null) => void;
  select: (ref: NodeRef | null, options?: { focus?: boolean }) => void;
  hover: (ref: NodeRef | null) => void;
  focusDirectory: (directoryId: string | null) => void;
  setVisualMode: (mode: VisualMode) => void;
  toggleDependencies: (value?: boolean) => void;
  setNavigationMode: (mode: NavigationMode) => void;
  issueCameraCommand: (command: CameraCommand) => void;
  setCameraPose: (pose: CameraPose) => void;
  setTimeline: (patch: Partial<TimelineState>) => void;
  setActiveContributor: (contributorId: string | null) => void;
  setPanel: (panel: PanelId, open: boolean) => void;
  togglePanel: (panel: PanelId) => void;
  openCodeViewer: (state: CodeViewerState) => void;
  closeCodeViewer: () => void;
  setReducedMotion: (value: boolean) => void;
  setWebglAvailable: (value: boolean) => void;
  /** Clears all repository-specific state (navigating to another repository). */
  reset: () => void;
}

const CLOSED_PANELS: Record<PanelId, boolean> = {
  search: false,
  analytics: false,
  contributors: false,
  shortcuts: false,
  share: false,
  summary: false,
};

const initialRepositoryState = {
  graph: null,
  index: null,
  layout: null,
  selection: null,
  hovered: null,
  focusedDirectoryId: null,
  visualMode: "architecture" as VisualMode,
  showDependencies: false,
  timeline: { active: false, cursor: null, windowDays: 30 } satisfies TimelineState,
  activeContributorId: null,
  panels: CLOSED_PANELS,
  codeViewer: null,
  cameraCommand: null,
  cameraPose: null,
} as const;

let commandNonce = 0;

function nodeExists(index: GraphIndex | null, ref: NodeRef): boolean {
  if (!index) return false;
  switch (ref.kind) {
    case "directory":
      return index.directoriesById.has(ref.id);
    case "file":
      return index.filesById.has(ref.id);
    case "symbol":
      return index.symbolsById.has(ref.id);
  }
}

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  ...initialRepositoryState,
  navigationMode: "orbit",
  reducedMotion: false,
  webglAvailable: null,

  loadGraph: (graph) => {
    const index = buildGraphIndex(graph);
    const previous = get();
    const sameRepository =
      previous.graph?.repository.id === graph.repository.id &&
      previous.graph?.repository.commitSha === graph.repository.commitSha;
    set({
      graph,
      index,
      // Keep the layout when upgrading a preview graph of the same commit; the
      // layout hook recomputes it and swaps it in once ready.
      layout: sameRepository ? previous.layout : null,
      // Drop selection/hover that no longer resolve in the new graph.
      selection: previous.selection && nodeExists(index, previous.selection) ? previous.selection : null,
      hovered: null,
      focusedDirectoryId:
        previous.focusedDirectoryId && index.directoriesById.has(previous.focusedDirectoryId)
          ? previous.focusedDirectoryId
          : null,
    });
  },

  setLayout: (layout) => set({ layout }),

  select: (ref, options) => {
    if (ref && !nodeExists(get().index, ref)) return;
    set({ selection: ref });
    if (ref && options?.focus) get().issueCameraCommand({ type: "focus-node", ref });
  },

  hover: (ref) => {
    const current = get().hovered;
    if (current?.id === ref?.id && current?.kind === ref?.kind) return;
    set({ hovered: ref });
  },

  focusDirectory: (directoryId) => {
    if (directoryId && !get().index?.directoriesById.has(directoryId)) return;
    set({ focusedDirectoryId: directoryId });
    if (directoryId) {
      get().issueCameraCommand({ type: "focus-node", ref: { kind: "directory", id: directoryId } });
    }
  },

  setVisualMode: (mode) =>
    set((state) => ({
      visualMode: mode,
      showDependencies: mode === "dependencies" ? true : state.showDependencies,
      timeline: mode === "activity" ? { ...state.timeline, active: true } : state.timeline,
      panels: mode === "contributors" ? { ...state.panels, contributors: true } : state.panels,
    })),

  toggleDependencies: (value) => set((state) => ({ showDependencies: value ?? !state.showDependencies })),

  setNavigationMode: (mode) => set({ navigationMode: mode }),

  issueCameraCommand: (command) => {
    commandNonce += 1;
    set({ cameraCommand: { ...command, nonce: commandNonce } });
  },

  setCameraPose: (pose) => set({ cameraPose: pose }),

  setTimeline: (patch) => set((state) => ({ timeline: { ...state.timeline, ...patch } })),

  setActiveContributor: (contributorId) =>
    set((state) => ({
      activeContributorId: contributorId,
      visualMode: contributorId ? "contributors" : state.visualMode,
    })),

  setPanel: (panel, open) => set((state) => ({ panels: { ...state.panels, [panel]: open } })),

  togglePanel: (panel) => set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } })),

  openCodeViewer: (codeViewer) => {
    if (!get().index?.filesById.has(codeViewer.fileId)) return;
    set({ codeViewer });
  },

  closeCodeViewer: () => set({ codeViewer: null }),

  setReducedMotion: (reducedMotion) => set({ reducedMotion }),

  setWebglAvailable: (webglAvailable) => set({ webglAvailable }),

  reset: () => set({ ...initialRepositoryState }),
}));

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectSelectedFile = (state: ExplorerState) =>
  state.selection?.kind === "file" ? (state.index?.filesById.get(state.selection.id) ?? null) : null;

export const selectSelectedDirectory = (state: ExplorerState) =>
  state.selection?.kind === "directory"
    ? (state.index?.directoriesById.get(state.selection.id) ?? null)
    : null;

export const selectSelectedSymbol = (state: ExplorerState) =>
  state.selection?.kind === "symbol" ? (state.index?.symbolsById.get(state.selection.id) ?? null) : null;

/** True when any modal overlay that should capture keyboard input is open. */
export const selectHasBlockingOverlay = (state: ExplorerState) =>
  state.panels.search || state.panels.share || state.panels.shortcuts || state.codeViewer !== null;
