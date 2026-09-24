import type { ExplorerState } from "@/state/explorer-store";
import { explorePath } from "@/lib/validation/repository-url";
import type { ShareState } from "./url-state";

/**
 * Bridges the explorer store and shareable URL state:
 * - `captureShareState` reads the current view into a ShareState (defaults are
 *   omitted so links stay short),
 * - `applyShareState` restores a decoded ShareState into the store.
 */

export interface ShareCaptureOptions {
  includeCamera: boolean;
  includeSelection: boolean;
  /** Pin the link to the analysed commit SHA instead of the requested ref. */
  pinCommit: boolean;
  /** Ref the explorer was opened with (?ref=), kept when not pinning. */
  requestedRef?: string;
}

type CaptureSource = Pick<
  ExplorerState,
  | "graph"
  | "visualMode"
  | "selection"
  | "cameraPose"
  | "showDependencies"
  | "navigationMode"
  | "activeContributorId"
  | "timeline"
>;

export function captureShareState(state: CaptureSource, options: ShareCaptureOptions): ShareState {
  const share: ShareState = {};
  const ref = options.pinCommit ? state.graph?.repository.commitSha : options.requestedRef;
  if (ref) share.ref = ref;
  const timelineCursor =
    state.timeline.active &&
    state.timeline.cursor !== null &&
    Number.isFinite(state.timeline.cursor)
      ? Math.round(state.timeline.cursor)
      : undefined;
  // Restoring a timeline switches to Activity mode, so a timeline link names its mode even when it is the default.
  if (state.visualMode !== "architecture" || timelineCursor !== undefined)
    share.mode = state.visualMode;
  if (options.includeSelection && state.selection) share.selection = state.selection;
  // Dependencies mode turns dependency lines on; only record deviations from that default.
  if (state.showDependencies !== (state.visualMode === "dependencies"))
    share.deps = state.showDependencies;
  if (state.navigationMode !== "orbit") share.nav = state.navigationMode;
  if (state.activeContributorId) share.contributor = state.activeContributorId;
  if (timelineCursor !== undefined) share.t = timelineCursor;
  if (options.includeCamera && state.cameraPose) share.camera = state.cameraPose;
  return share;
}

type ApplyTarget = Pick<
  ExplorerState,
  | "index"
  | "setActiveContributor"
  | "setVisualMode"
  | "toggleDependencies"
  | "setNavigationMode"
  | "setTimeline"
  | "select"
  | "issueCameraCommand"
>;

export interface ApplyShareOptions {
  /** False when the 3D world is not shown (camera state is meaningless then). */
  worldEnabled: boolean;
}

/**
 * Applies decoded share state to the store. Order matters: the contributor and
 * the timeline are applied first (they switch to contributors and activity
 * mode), then an explicit mode, then explicit dependency visibility. The selection is restored without a
 * camera flight; an explicit camera pose is jumped to without animation so the
 * default cinematic intro does not play.
 */
export function applyShareState(
  store: ApplyTarget,
  share: ShareState,
  options: ApplyShareOptions,
): void {
  if (share.contributor && store.index?.contributorsById.has(share.contributor)) {
    store.setActiveContributor(share.contributor);
  }
  if (share.t !== undefined) store.setTimeline({ active: true, cursor: share.t });
  if (share.mode) store.setVisualMode(share.mode);
  if (share.deps !== undefined) store.toggleDependencies(share.deps);
  if (share.nav && options.worldEnabled) store.setNavigationMode(share.nav);
  if (share.selection) store.select(share.selection);
  if (share.camera && options.worldEnabled) {
    store.issueCameraCommand({ type: "set-pose", pose: share.camera, animate: false });
  }
}

/** Whether a share state carries anything to restore. */
export function hasViewState(share: ShareState): boolean {
  return (
    share.mode !== undefined ||
    share.selection !== undefined ||
    share.camera !== undefined ||
    share.deps !== undefined ||
    share.nav !== undefined ||
    share.contributor !== undefined ||
    share.t !== undefined
  );
}

/** Same-origin URL of the per-repository social preview image. */
export function socialImagePath(owner: string, repo: string): string {
  return `${explorePath(owner, repo)}/opengraph-image`;
}
