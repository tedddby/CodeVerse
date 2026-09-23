"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/panel";
import type { GraphIndex } from "@/graph/model/graph-index";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger, pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { ContributorAvatar } from "./contributor-avatar";
import { ContributorDetail } from "./contributor-detail";
import { sortContributors } from "./contributors-model";
import { LEFT_DOCK_CLASS, useExclusiveLeftDock } from "./left-dock";

/** Show a filter box once the list gets long. */
const FILTER_THRESHOLD = 10;

/**
 * Left-docked contributor list (`panels.contributors`). Choosing a contributor
 * switches the world to contributors mode (their files light up) and shows what
 * they worked on within the analysed history window.
 */
export function ContributorsPanel() {
  const open = useExplorerStore((state) => state.panels.contributors);
  const index = useExplorerStore((state) => state.index);
  useExclusiveLeftDock("contributors", open);
  if (!open || !index) return null;
  return <ContributorsPanelContent index={index} />;
}

function ContributorsPanelContent({ index }: { index: GraphIndex }) {
  const activeId = useExplorerStore((state) => state.activeContributorId);
  const setActiveContributor = useExplorerStore((state) => state.setActiveContributor);
  const focusDirectory = useExplorerStore((state) => state.focusDirectory);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const [filter, setFilter] = useState("");

  const contributors = useMemo(
    () => sortContributors(index.graph.contributors),
    [index.graph.contributors],
  );
  const active = activeId ? index.contributorsById.get(activeId) : undefined;
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? contributors.filter(
        (contributor) =>
          contributor.name.toLowerCase().includes(needle) ||
          (contributor.login?.toLowerCase().includes(needle) ?? false),
      )
    : contributors;
  const historyUnavailable = index.graph.analysis.warnings.find(
    (warning) => warning.code === "HISTORY_UNAVAILABLE",
  );

  return (
    <Panel
      eyebrow={index.graph.repository.fullName}
      title={
        contributors.length > 0
          ? `Contributors · ${formatInteger(contributors.length)}`
          : "Contributors"
      }
      aria-label="Contributors"
      onClose={() => setPanel("contributors", false)}
      className={cn(LEFT_DOCK_CLASS, !reducedMotion && "animate-fade-in")}
      bodyClassName="space-y-3"
    >
      {active ? (
        <ContributorDetail
          index={index}
          contributor={active}
          onClear={() => setActiveContributor(null)}
          onFocusDirectory={focusDirectory}
        />
      ) : contributors.length > 0 ? (
        <p className="text-ink-subtle text-xs">
          Select a contributor to highlight the files they touched.
        </p>
      ) : null}

      {contributors.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-ink text-sm">No contributor data.</p>
          <p className="text-ink-subtle mt-1 text-xs">
            {historyUnavailable?.message ??
              "The provider did not report contributors for this repository."}
          </p>
        </div>
      ) : (
        <>
          {contributors.length > FILTER_THRESHOLD ? (
            <label className="border-line-strong bg-abyss/60 flex items-center gap-2 rounded-lg border px-2.5">
              <Search aria-hidden="true" className="text-ink-subtle size-3.5" />
              <span className="sr-only">Filter contributors</span>
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by name or login"
                className="text-ink placeholder:text-ink-subtle h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </label>
          ) : null}
          <ul aria-label="Contributors" className="-mx-1.5 space-y-0.5">
            {visible.map((contributor) => {
              const isActive = contributor.id === activeId;
              return (
                <li key={contributor.id}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveContributor(isActive ? null : contributor.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                      isActive
                        ? "bg-signal/10 shadow-[inset_0_0_0_1px_rgba(77,226,255,0.3)]"
                        : "hover:bg-panel-raised",
                    )}
                  >
                    <ContributorAvatar contributor={contributor} size={26} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-xs",
                          isActive ? "text-ink" : "text-ink-muted",
                        )}
                      >
                        {contributor.name}
                      </span>
                      {contributor.login && contributor.login !== contributor.name ? (
                        <span className="text-ink-subtle block truncate font-mono text-[10.5px]">
                          @{contributor.login}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-ink block font-mono text-xs tabular-nums">
                        {contributor.contributions > 0
                          ? formatCompact(contributor.contributions)
                          : "—"}
                      </span>
                      <span className="text-ink-subtle block text-[10px]">
                        {pluralize(contributor.commitCount, "commit")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <p className="text-ink-subtle text-center text-xs">
              No contributors match “{filter.trim()}”.
            </p>
          ) : null}
        </>
      )}

      <p className="border-line/60 text-ink-subtle border-t pt-2 text-[10.5px] leading-relaxed">
        Public GitHub data only. The first number is all-time contributions reported by GitHub;
        commit counts cover the analysed history window.
      </p>
    </Panel>
  );
}
