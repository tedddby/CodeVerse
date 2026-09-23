"use client";

import { CameraRig } from "@/engine/camera/camera-rig";
import { EMPTY_WORLD } from "@/engine/camera/camera-controller";
import { useExplorerStore } from "@/state/explorer-store";
import { Atmosphere } from "./atmosphere";
import { Buildings } from "./buildings";
import { DependencyEdges } from "./dependency-edges";
import { DistrictLabels } from "./district-labels";
import { Districts } from "./districts";
import { Ground } from "./ground";
import { HoverTooltip } from "./hover-tooltip";
import { SelectionHighlight } from "./selection-highlight";
import { AdaptiveResolution, StatsProbe } from "./stats-probe";
import { SymbolBands } from "./symbol-bands";
import { WorldProvider } from "./world-context";

/**
 * Everything inside the Canvas. Before a layout exists only the environment
 * (ground, grid, atmosphere) is rendered; the camera rig is always present.
 */
export function UniverseScene({
  interactive,
  autoRotate,
}: {
  interactive: boolean;
  autoRotate: boolean;
}) {
  const layout = useExplorerStore((state) => state.layout);
  const index = useExplorerStore((state) => state.index);
  const bounds = layout?.bounds;
  const worldSize = bounds ? Math.max(1, bounds.size) : EMPTY_WORLD.size;
  const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
  const centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;

  return (
    <>
      <Atmosphere worldSize={worldSize} />
      <Ground centerX={centerX} centerZ={centerZ} worldSize={worldSize} />
      {layout && index ? (
        <WorldProvider layout={layout} index={index} interactive={interactive}>
          <Districts />
          <Buildings />
          <DistrictLabels />
          <SymbolBands />
          <DependencyEdges />
          <SelectionHighlight />
          {interactive ? <HoverTooltip /> : null}
        </WorldProvider>
      ) : null}
      <CameraRig interactive={interactive} autoRotate={autoRotate} />
      <AdaptiveResolution />
      <StatsProbe />
    </>
  );
}
