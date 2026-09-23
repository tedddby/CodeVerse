"use client";

import { ExternalLink } from "lucide-react";
import { useCallback } from "react";
import { Panel } from "@/components/ui/panel";
import { Stat } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { NodeRef } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { repositoryStats, safeHttpsUrl } from "./analytics-model";
import {
  CoverageSection,
  FileHighlightsSection,
  LanguagesSection,
  PackagesSection,
  PanelSection,
} from "./analytics-sections";
import { LEFT_DOCK_CLASS, useExclusiveLeftDock } from "./left-dock";

/**
 * Left-docked repository statistics (`panels.analytics`, shortcut "I"):
 * headline numbers, languages, external packages, notable files and an honest
 * account of what the analysis covered.
 */
export function AnalyticsPanel() {
  const open = useExplorerStore((state) => state.panels.analytics);
  const index = useExplorerStore((state) => state.index);
  useExclusiveLeftDock("analytics", open);
  if (!open || !index) return null;
  return <AnalyticsPanelContent index={index} />;
}

function AnalyticsPanelContent({ index }: { index: GraphIndex }) {
  const setPanel = useExplorerStore((state) => state.setPanel);
  const select = useExplorerStore((state) => state.select);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const onSelect = useCallback((ref: NodeRef) => select(ref, { focus: true }), [select]);
  const { repository } = index.graph;
  const stats = repositoryStats(index);
  const repositoryUrl = safeHttpsUrl(repository.url);

  return (
    <Panel
      eyebrow="Repository statistics"
      title={repository.fullName}
      aria-label="Repository statistics"
      onClose={() => setPanel("analytics", false)}
      className={cn(LEFT_DOCK_CLASS, !reducedMotion && "animate-fade-in")}
      bodyClassName="space-y-4"
      actions={
        repositoryUrl ? (
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open repository${repository.provider === "github" ? " on GitHub" : ""} (opens in a new tab)`}
            className="text-ink-subtle hover:bg-panel-raised hover:text-ink rounded-md p-1.5 transition-colors"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null
      }
    >
      {repository.description ? (
        <p className="text-ink-muted text-xs leading-relaxed">{repository.description}</p>
      ) : null}

      <PanelSection label="Repository">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5">
          <Stat label="Stars" value={formatCompact(stats.stars)} />
          <Stat label="Forks" value={formatCompact(stats.forks)} />
          <Stat label="Files" value={formatInteger(stats.filesInRepository)} />
          <Stat
            label="Analysed"
            value={formatInteger(stats.filesAnalysed)}
            hint={
              stats.filesAnalysed < stats.filesInRepository
                ? `of ${formatCompact(stats.filesInRepository)}`
                : undefined
            }
          />
          <Stat
            label="Lines of code"
            value={`${stats.linesEstimated ? "~" : ""}${formatCompact(stats.linesOfCode)}`}
            hint={stats.linesEstimated ? "est." : undefined}
          />
          <Stat label="Symbols" value={formatCompact(stats.symbols)} />
          <Stat label="Dependencies" value={formatCompact(stats.dependencies)} />
          <Stat label="Ext. packages" value={formatInteger(stats.externalPackages)} />
          <Stat
            label="Contributors"
            value={formatInteger(stats.contributors)}
            className="col-span-2"
          />
        </dl>
        {stats.linesEstimated ? (
          <p className="text-ink-subtle mt-1.5 text-[11px]">
            Some line counts are estimated from file sizes because their content was not downloaded.
          </p>
        ) : null}
      </PanelSection>

      <LanguagesSection index={index} />
      <PackagesSection index={index} />
      <FileHighlightsSection index={index} onSelect={onSelect} />
      <CoverageSection index={index} />
    </Panel>
  );
}
