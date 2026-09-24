import type { ExplorerState } from "@/state/explorer-store";

/**
 * The only explorer state district slabs and outlines depend on. Hovering or
 * selecting a building or symbol leaves it unchanged, so those (frequent)
 * store updates must not rewrite any district.
 */
export interface DistrictStateKey {
  hoveredId: string | null;
  selectedId: string | null;
  focusedId: string | null;
}

export function districtStateKey(state: ExplorerState): DistrictStateKey {
  return {
    hoveredId: state.hovered?.kind === "directory" ? state.hovered.id : null,
    selectedId: state.selection?.kind === "directory" ? state.selection.id : null,
    focusedId: state.focusedDirectoryId,
  };
}

/**
 * Districts to rewrite when the key changes from `previous` to `next`:
 * nothing when it is unchanged, every district when focus changed (emphasis
 * of whole subtrees), otherwise just the (at most four) districts hovered or
 * selected before or after.
 */
export function districtsToRewrite(
  previous: DistrictStateKey | null,
  next: DistrictStateKey,
): "all" | string[] {
  if (!previous || previous.focusedId !== next.focusedId) return "all";
  if (previous.hoveredId === next.hoveredId && previous.selectedId === next.selectedId) return [];
  const ids = new Set<string>();
  for (const id of [previous.hoveredId, previous.selectedId, next.hoveredId, next.selectedId]) {
    if (id !== null) ids.add(id);
  }
  return [...ids];
}
