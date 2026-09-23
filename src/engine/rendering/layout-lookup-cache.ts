import { buildLayoutLookup, type LayoutLookup } from "@/engine/layout/lookup";
import type { WorldLayout } from "@/engine/layout/types";

const lookupCache = new WeakMap<WorldLayout, LayoutLookup>();

/**
 * Layout lookup memoized per layout object, shared by every renderer layer
 * and the camera rig so the O(n) maps are built once per layout.
 */
export function getLayoutLookup(layout: WorldLayout): LayoutLookup {
  let lookup = lookupCache.get(layout);
  if (!lookup) {
    lookup = buildLayoutLookup(layout);
    lookupCache.set(layout, lookup);
  }
  return lookup;
}
