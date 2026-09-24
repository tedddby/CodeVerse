"use client";

import { ArrowDownLeft, ArrowUpRight, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { Badge, LanguageDot, ProgressBar, SectionLabel } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, NodeRef } from "@/graph/model/types";
import {
  formatCompact,
  formatInteger,
  formatPercent,
  formatRelativeTime,
  pluralize,
} from "@/lib/utils/format";
import {
  formatDuration,
  languageSegments,
  largestFiles,
  mostConnectedFiles,
  parseCoverage,
  stageTimings,
  TIER_COPY,
  topExternalPackages,
} from "./analytics-model";

export function PanelSection({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="border-line/60 border-t pt-3 first:border-t-0 first:pt-0"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function LanguagesSection({ index }: { index: GraphIndex }) {
  const segments = languageSegments(index.graph.languages);
  if (segments.length === 0) {
    return (
      <PanelSection label="Languages">
        <p className="text-ink-subtle text-xs">No language data.</p>
      </PanelSection>
    );
  }
  return (
    <PanelSection
      label="Languages"
      aside={<span className="text-ink-subtle text-[10.5px]">by bytes</span>}
    >
      <div
        aria-hidden="true"
        className="bg-line mb-2.5 flex h-2 w-full overflow-hidden rounded-full"
      >
        {segments.map((segment) => (
          <span
            key={segment.id}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${segment.share * 100}%`,
              backgroundColor: segment.color,
              minWidth: segment.share > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <ul className="space-y-1">
        {segments.map((segment) => (
          <li key={segment.id} className="flex items-center gap-2 text-xs">
            {segment.id === "other" ? (
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
            ) : (
              <LanguageDot language={segment.id} />
            )}
            <span className="text-ink-muted min-w-0 flex-1 truncate">{segment.name}</span>
            {segment.parseable ? (
              <Badge tone="signal" title="Parsed into symbols and imports">
                parsed
              </Badge>
            ) : null}
            <span className="text-ink w-10 text-right font-mono tabular-nums">
              {formatPercent(segment.share)}
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

export function PackagesSection({ index }: { index: GraphIndex }) {
  const packages = topExternalPackages(index.graph.externalPackages, 10);
  if (packages.length === 0) return null;
  const max = packages[0]?.importCount ?? 1;
  return (
    <PanelSection label="Top external packages">
      <ul className="space-y-1.5">
        {packages.map((pkg) => (
          <li key={`${pkg.language}:${pkg.name}`} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span
                className="text-ink-muted min-w-0 flex-1 truncate font-mono"
                title={escapeHiddenCharacters(pkg.name)}
              >
                {revealHiddenCharacters(pkg.name)}
              </span>
              <span
                className="text-ink font-mono tabular-nums"
                title={`${pluralize(pkg.fileCount, "file")}`}
              >
                {formatInteger(pkg.importCount)}
              </span>
            </div>
            <div aria-hidden="true" className="bg-line mt-0.5 h-0.5 rounded-full">
              <div
                className="bg-ion/70 h-full rounded-full"
                style={{ width: `${(pkg.importCount / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

interface FileRowProps {
  file: FileNode;
  value: ReactNode;
  onSelect: (ref: NodeRef) => void;
}

function FileRow({ file, value, onSelect }: FileRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect({ kind: "file", id: file.id })}
        title={escapeHiddenCharacters(file.path)}
        className="group hover:bg-panel-raised flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors"
      >
        <LanguageDot language={file.language} />
        <span className="text-ink-muted group-hover:text-ink min-w-0 flex-1 truncate font-mono">
          {revealHiddenCharacters(file.name)}
        </span>
        <span className="text-ink-subtle shrink-0 font-mono tabular-nums">{value}</span>
      </button>
    </li>
  );
}

export function FileHighlightsSection({
  index,
  onSelect,
}: {
  index: GraphIndex;
  onSelect: (ref: NodeRef) => void;
}) {
  const largest = largestFiles(index.graph, 5);
  const connected = mostConnectedFiles(index, 5);
  return (
    <>
      {largest.length > 0 ? (
        <PanelSection label="Largest files">
          <ul>
            {largest.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onSelect={onSelect}
                value={`${file.linesEstimated ? "~" : ""}${formatCompact(file.lines)} LOC`}
              />
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {connected.length > 0 ? (
        <PanelSection label="Most-connected files">
          <ul>
            {connected.map(({ file, incoming, outgoing }) => (
              <FileRow
                key={file.id}
                file={file}
                onSelect={onSelect}
                value={
                  <span
                    className="flex items-center gap-1.5"
                    aria-label={`${incoming} importers, ${outgoing} imports`}
                  >
                    <span className="flex items-center" title="Imported by">
                      <ArrowDownLeft aria-hidden="true" className="size-3" />
                      {incoming}
                    </span>
                    <span className="flex items-center" title="Imports">
                      <ArrowUpRight aria-hidden="true" className="size-3" />
                      {outgoing}
                    </span>
                  </span>
                }
              />
            ))}
          </ul>
        </PanelSection>
      ) : null}
    </>
  );
}

export function CoverageSection({ index }: { index: GraphIndex }) {
  const { analysis } = index.graph;
  const tier = TIER_COPY[analysis.tier];
  const coverage = parseCoverage(index.graph);
  const timings = stageTimings(analysis.timings);
  const { rateLimit } = analysis;
  return (
    <PanelSection
      label="Analysis coverage"
      aside={
        <span className="flex items-center gap-1">
          {analysis.cached ? <Badge tone="ion">cached</Badge> : null}
          <Badge tone={analysis.tier === "full" ? "ok" : "warn"}>{tier.label}</Badge>
        </span>
      }
    >
      <p className="text-ink-subtle mb-2 text-xs">{tier.description}</p>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-muted">Parse coverage</span>
        <span className="text-ink font-mono tabular-nums">
          {formatInteger(coverage.parsed)} / {formatInteger(coverage.eligible)}
        </span>
      </div>
      <ProgressBar
        value={coverage.share}
        label="Parse coverage"
        tone={coverage.share >= 0.95 ? "ok" : "signal"}
      />
      <p className="text-ink-subtle mt-1 text-[11px]">
        Files in parseable languages that were parsed into symbols and imports.
      </p>

      {analysis.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label="Analysis warnings">
          {analysis.warnings.map((warning, i) => (
            <li
              key={`${warning.code}-${i}`}
              className="border-warn/25 bg-warn/5 text-ink-muted flex gap-2 rounded-md border px-2 py-1.5 text-[11.5px]"
            >
              <TriangleAlert aria-hidden="true" className="text-warn mt-0.5 size-3.5 shrink-0" />
              <span>{revealHiddenCharacters(warning.message)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {analysis.unsupportedLanguages.length > 0 ? (
        <p className="text-ink-subtle mt-3 text-[11.5px]">
          <span className="text-ink-muted">Not parsed (no grammar): </span>
          {analysis.unsupportedLanguages
            .slice(0, 6)
            .map((language) => `${language.name} (${formatInteger(language.files)})`)
            .join(", ")}
          {analysis.unsupportedLanguages.length > 6
            ? `, +${analysis.unsupportedLanguages.length - 6} more`
            : ""}
        </p>
      ) : null}

      {timings.length > 0 ? (
        <details className="mt-3 text-xs">
          <summary className="text-ink-muted hover:text-ink cursor-pointer select-none">
            Timings · {formatDuration(analysis.durationMs)} total
          </summary>
          <dl className="mt-1.5 space-y-0.5">
            {timings.map((timing) => (
              <div key={timing.id} className="flex justify-between gap-3">
                <dt className="text-ink-subtle">{timing.label}</dt>
                <dd className="text-ink-muted font-mono tabular-nums">
                  {formatDuration(timing.ms)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <p className="text-ink-subtle mt-3 text-[11px]">
        Analysed {formatRelativeTime(analysis.generatedAt)} · analyzer {analysis.analyzerVersion}
        {rateLimit ? (
          <>
            {" "}
            · GitHub API {formatInteger(rateLimit.remaining)}/{formatInteger(rateLimit.limit)}{" "}
            requests left
            {rateLimit.authenticated ? "" : " (unauthenticated)"}, resets{" "}
            {formatRelativeTime(rateLimit.resetAt)}
          </>
        ) : null}
      </p>
    </PanelSection>
  );
}
