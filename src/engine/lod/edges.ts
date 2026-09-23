import type { DependencyEdge } from "@/graph/model/types";

/**
 * Dependency-edge budgeting. Drawing every import of a large repository would
 * be both slow and unreadable, so the renderer only ever draws a bounded,
 * meaningful subset:
 * - with a selection: the selection's own incoming/outgoing edges (always);
 * - with a focused directory: edges inside the focused subtree;
 * - otherwise: the heaviest edges of the repository.
 */

export type EdgeRole = "outgoing" | "incoming" | "internal" | "focus" | "top";

export interface BudgetedEdge {
  edge: DependencyEdge;
  role: EdgeRole;
}

export interface EdgeBudgetOptions {
  /** Files forming the selection subject (a file, a symbol's file or a directory subtree). */
  selectedFileIds: ReadonlySet<string>;
  /** Files of the focused directory subtree, or null without focus. */
  focusFileIds: ReadonlySet<string> | null;
  /** Only edges whose endpoints both have a building are drawable. */
  isDrawable: (fileId: string) => boolean;
  /** Edge cap without selection/focus (the repository overview). */
  overviewBudget?: number;
  /** Edge cap inside a focused directory. */
  focusBudget?: number;
  /** Hard safety cap for selection edges. */
  selectionBudget?: number;
}

export const DEFAULT_OVERVIEW_EDGE_BUDGET = 1_500;
export const DEFAULT_FOCUS_EDGE_BUDGET = 5_000;
export const DEFAULT_SELECTION_EDGE_BUDGET = 4_000;

/** Heaviest first; ties broken by id so the result is deterministic. */
function byWeight(a: DependencyEdge, b: DependencyEdge): number {
  return b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * At most `limit` entries of `edges` (mutated: sorted in place) in `byWeight`
 * order. Budgeting runs only when the selection, focus or layout changes, so a
 * full sort is cheap enough and keeps the policy obvious.
 */
function heaviest(edges: DependencyEdge[], limit: number): DependencyEdge[] {
  edges.sort(byWeight);
  return edges.length > limit ? edges.slice(0, Math.max(0, limit)) : edges;
}

export function budgetDependencyEdges(
  edges: readonly DependencyEdge[],
  options: EdgeBudgetOptions,
): BudgetedEdge[] {
  const { selectedFileIds, focusFileIds, isDrawable } = options;
  const drawable = (edge: DependencyEdge) =>
    edge.source !== edge.target && isDrawable(edge.source) && isDrawable(edge.target);

  if (selectedFileIds.size > 0) {
    const related: DependencyEdge[] = [];
    for (const edge of edges) {
      if (
        (selectedFileIds.has(edge.source) || selectedFileIds.has(edge.target)) &&
        drawable(edge)
      ) {
        related.push(edge);
      }
    }
    return heaviest(related, options.selectionBudget ?? DEFAULT_SELECTION_EDGE_BUDGET).map(
      (edge) => {
        const fromSelection = selectedFileIds.has(edge.source);
        const toSelection = selectedFileIds.has(edge.target);
        const role: EdgeRole =
          fromSelection && toSelection ? "internal" : fromSelection ? "outgoing" : "incoming";
        return { edge, role };
      },
    );
  }

  if (focusFileIds) {
    const inside: DependencyEdge[] = [];
    for (const edge of edges) {
      if (focusFileIds.has(edge.source) && focusFileIds.has(edge.target) && drawable(edge))
        inside.push(edge);
    }
    return heaviest(inside, options.focusBudget ?? DEFAULT_FOCUS_EDGE_BUDGET).map((edge) => ({
      edge,
      role: "focus",
    }));
  }

  const candidates = edges.filter(drawable);
  return heaviest(candidates, options.overviewBudget ?? DEFAULT_OVERVIEW_EDGE_BUDGET).map(
    (edge) => ({
      edge,
      role: "top",
    }),
  );
}
