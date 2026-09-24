"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { Panel } from "@/components/ui/panel";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { ContributorNode } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger, pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { ContributorAvatar } from "./contributor-avatar";
import { ContributorDetail } from "./contributor-detail";
import { partitionByWindowActivity, sortContributors } from "./contributors-model";
import { LEFT_DOCK_CLASS, useExclusiveLeftDock } from "./left-dock";

/** Show a filter box once the list gets long. */
const FILTER_THRESHOLD = 10;

/** The filter field hides its own outline, so its box shows keyboard focus instead. */
const FILTER_BOX_CLASS =
  "border-line-strong bg-abyss/60 flex items-center gap-2 rounded-lg border px-2.5 focus-within:ring-2 focus-within:ring-signal/60";

/**
 * Left-docked contributor list (`panels.contributors`). Choosing a contributor
 * switches the world to contributors mode (their files light up) and shows what
 * they worked on within the analysed history window. Contributors who touched
 * files in that window come first, with their file counts; the rest are listed
 * last, muted, since selecting them highlights nothing.
 */
export function ContributorsPanel() {
  const open = useExplorerStore((state) => state.panels.contributors);
  const index = useExplorerStore((state) => state.index);
  useExclusiveLeftDock("contributors", open);
  if (!open || !index) return null;
  return <ContributorsPanelContent index={index} />;
}

function matchesFilter(contributor: ContributorNode, needle: string): boolean {
  return (
    contributor.name.toLowerCase().includes(needle) ||
    (contributor.login?.toLowerCase().includes(needle) ?? false)
  );
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
    ? contributors.filter((contributor) => matchesFilter(contributor, needle))
    : contributors;
  const groups = partitionByWindowActivity(visible);
  const historyUnavailable = index.graph.analysis.warnings.find(
    (warning) => warning.code === "HISTORY_UNAVAILABLE",
  );
  const toggle = (contributor: ContributorNode) =>
    setActiveContributor(contributor.id === activeId ? null : contributor.id);

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
            <label className={FILTER_BOX_CLASS}>
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
          {groups.active.length > 0 ? (
            <ContributorGroup
              caption="Touched files in the analysed window"
              contributors={groups.active}
              activeId={activeId}
              onToggle={toggle}
            />
          ) : null}
          {groups.inactive.length > 0 ? (
            <ContributorGroup
              caption="No files touched in the analysed window"
              contributors={groups.inactive}
              activeId={activeId}
              muted
              onToggle={toggle}
            />
          ) : null}
          {visible.length === 0 ? (
            <p className="text-ink-subtle text-center text-xs">
              No contributors match “{filter.trim()}”.
            </p>
          ) : null}
        </>
      )}

      <p className="border-line/60 text-ink-subtle border-t pt-2 text-[10.5px] leading-relaxed">
        Public GitHub data only. Contributors who touched the most files in the analysed history
        window come first. The first number is all-time contributions reported by GitHub; file and
        commit counts cover the analysed window.
      </p>
    </Panel>
  );
}

/**
 * A captioned list of contributors. Those with files touched in the analysed
 * window get a signal-tinted caption and file counts; the rest are muted.
 */
function ContributorGroup({
  caption,
  contributors,
  activeId,
  muted = false,
  onToggle,
}: {
  caption: string;
  contributors: readonly ContributorNode[];
  activeId: string | null;
  muted?: boolean;
  onToggle: (contributor: ContributorNode) => void;
}) {
  const captionId = useId();
  return (
    <div>
      <p
        id={captionId}
        className={cn(
          "mb-1 font-mono text-[10px] tracking-[0.14em] uppercase",
          muted ? "text-ink-subtle" : "text-signal/80",
        )}
      >
        {caption}
      </p>
      <ul aria-labelledby={captionId} className="-mx-1.5 space-y-0.5">
        {contributors.map((contributor) => (
          <ContributorRow
            key={contributor.id}
            contributor={contributor}
            active={contributor.id === activeId}
            muted={muted}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}

function ContributorRow({
  contributor,
  active,
  muted = false,
  onToggle,
}: {
  contributor: ContributorNode;
  active: boolean;
  /** No files touched in the analysed window: selecting highlights nothing. */
  muted?: boolean;
  onToggle: (contributor: ContributorNode) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onToggle(contributor)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors",
          active
            ? "bg-signal/10 shadow-[inset_0_0_0_1px_rgba(77,226,255,0.3)]"
            : "hover:bg-panel-raised",
        )}
      >
        <ContributorAvatar
          contributor={contributor}
          size={26}
          className={cn(muted && !active && "opacity-60")}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-xs",
              active ? "text-ink" : muted ? "text-ink-subtle" : "text-ink-muted",
            )}
          >
            {revealHiddenCharacters(contributor.name)}
          </span>
          {contributor.login && contributor.login !== contributor.name ? (
            <span className="text-ink-subtle block truncate font-mono text-[10.5px]">
              @{revealHiddenCharacters(contributor.login)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              "block font-mono text-xs tabular-nums",
              muted && !active ? "text-ink-muted" : "text-ink",
            )}
          >
            {contributor.contributions > 0 ? formatCompact(contributor.contributions) : "—"}
          </span>
          <span className="text-ink-subtle block text-[10px]">
            {muted ? null : (
              <>
                <span className="text-signal/90">
                  {pluralize(contributor.fileIds.length, "file")}
                </span>
                {" · "}
              </>
            )}
            {pluralize(contributor.commitCount, "commit")}
          </span>
        </span>
      </button>
    </li>
  );
}
