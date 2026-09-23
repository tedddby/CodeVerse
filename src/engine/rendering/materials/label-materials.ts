import { DoubleSide, MeshBasicMaterial } from "three";

/**
 * Base materials for troika text labels. troika derives its SDF text (and
 * outline) materials from the base by prototype, so render-state flags set
 * here apply to both passes. (Setting them on `mesh.material` does not work
 * once an outline is enabled: troika then exposes a material array.)
 */

/** Map annotations drawn over the city: no depth test, unlit, unfogged. */
export function createOverlayLabelMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0xffffff,
    side: DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

/** Labels attached to scene objects: depth-tested, fogged, but not tone mapped (legend-exact colors). */
export function createSceneLabelMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0xffffff,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
