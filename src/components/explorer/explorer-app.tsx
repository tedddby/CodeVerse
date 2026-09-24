"use client";

import type { ReactNode } from "react";
import { errorPayload } from "@/lib/analysis-client/events";
import { useRepositoryAnalysis } from "@/lib/analysis-client/use-repository-analysis";
import type { ShareState } from "@/lib/share/url-state";
import { useLayoutEngine } from "@/engine/layout/use-layout-engine";
import { useExplorerStore } from "@/state/explorer-store";
import { ErrorState } from "./error-state";
import { ExplorerShell } from "./explorer-shell";
import { LoadingExperience } from "./loading-experience";
import {
  useExplorerEntrance,
  useExplorerEnvironment,
  useRepositoryStoreLifecycle,
} from "./use-explorer-environment";
import { useExplorerPhase } from "./use-explorer-phase";
import { WorldViewport } from "./world-viewport";

export interface ExplorerAppProps {
  owner: string;
  repo: string;
  /** View state decoded from the URL (validated server-side); `ref` selects the analysed branch/tag/commit. */
  initialShareState: ShareState;
}

/**
 * The /explore/[owner]/[repo] experience: streams the real analysis, plays the
 * mission-control loading sequence over a dimmed preview of the world, then
 * hands over to the interactive explorer.
 */
export function ExplorerApp({ owner, repo, initialShareState }: ExplorerAppProps) {
  const requestedRef = initialShareState.ref;
  const fullName = `${owner}/${repo}`;

  useRepositoryStoreLifecycle(owner, repo, requestedRef);
  useExplorerEnvironment();
  const analysis = useRepositoryAnalysis({ owner, repo, ref: requestedRef });
  const layoutEngine = useLayoutEngine();
  const hasLayout = useExplorerStore((state) => state.layout !== null);
  const webglAvailable = useExplorerStore((state) => state.webglAvailable);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);

  const layoutFailed = !layoutEngine.computing && layoutEngine.error !== null;
  const worldEnabled = webglAvailable === true && !layoutFailed;
  const worldReady =
    webglAvailable === false || layoutFailed || (!layoutEngine.computing && hasLayout);
  const phase = useExplorerPhase({ status: analysis.status, worldReady, reducedMotion });
  useExplorerEntrance(
    initialShareState,
    phase === "entering" || phase === "explorer",
    worldEnabled,
  );

  // Missing WebGL is explained by the standalone summary itself; a failed layout is not.
  const worldUnavailableNotice =
    webglAvailable !== false && layoutFailed
      ? `The 3D layout could not be computed (${layoutEngine.error}). Showing a text overview of the repository instead.`
      : null;

  let overlay: ReactNode = null;
  if (phase === "error") {
    overlay = (
      <ErrorState
        error={analysis.error ?? errorPayload("INTERNAL")}
        owner={owner}
        repo={repo}
        onRetry={analysis.retry}
      />
    );
  } else if (phase === "loading" || phase === "entering") {
    overlay = (
      <LoadingExperience
        owner={owner}
        repo={repo}
        gitRef={requestedRef}
        status={analysis.status}
        stages={analysis.stages}
        warnings={analysis.warnings}
        elapsedMs={analysis.elapsedMs}
        layoutPending={analysis.status === "complete" && !worldReady}
        exiting={phase === "entering"}
      />
    );
  }

  return (
    <ExplorerShell
      phase={phase}
      fullName={fullName}
      worldEnabled={worldEnabled}
      worldUnavailableNotice={worldUnavailableNotice}
      requestedRef={requestedRef}
      world={<WorldViewport phase={phase} fullName={fullName} />}
      overlay={overlay}
    />
  );
}
