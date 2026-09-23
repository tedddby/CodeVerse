"use client";

import { ArrowDownLeft, ArrowUpRight, Code, Eye } from "lucide-react";
import { Fragment, useMemo } from "react";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import { githubBlobUrl } from "@/analysis/source-protocol";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, SymbolNode } from "@/graph/model/types";
import { formatBytes, formatDate, formatInteger, formatRelativeTime, pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { GitHubMark } from "@/components/brand/github-mark";
import {
  FILE_STATUS_COPY,
  SYMBOL_KIND_LABELS,
  SYMBOL_KIND_ORDER,
  countFileSymbols,
  dependentFileIds,
  fileSummaryLine,
  lineRangeLabel,
} from "./node-descriptions";
import {
  ActionButton,
  ActionLink,
  ContributorChip,
  CopyButton,
  ExpandableList,
  NodeLink,
  PanelSection,
  PathBreadcrumb,
  StatTile,
} from "./selection-parts";

const IMPORTS_SECTION_ID = "selection-imports";
const DEPENDENTS_SECTION_ID = "selection-dependents";

function scrollToSection(id: string, reducedMotion: boolean) {
  // Not every environment implements scrollIntoView (e.g. some embedded webviews).
  document.getElementById(id)?.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
}

interface ImportRow {
  key: string;
  label: string;
  resolvedFileId?: string;
  kind: "internal" | "external" | "unresolved";
}

function collectImports(file: FileNode, index: GraphIndex): ImportRow[] {
  const rows = new Map<string, ImportRow>();
  for (const entry of file.imports) {
    if (entry.resolvedFileId && index.filesById.has(entry.resolvedFileId)) {
      const target = index.filesById.get(entry.resolvedFileId);
      const key = `file:${entry.resolvedFileId}`;
      if (!rows.has(key)) rows.set(key, { key, label: target?.path ?? entry.specifier, resolvedFileId: entry.resolvedFileId, kind: "internal" });
    } else {
      const kind = entry.external ? "external" : "unresolved";
      const key = `${kind}:${entry.specifier}`;
      if (!rows.has(key)) rows.set(key, { key, label: entry.specifier, kind });
    }
  }
  const order = { internal: 0, external: 1, unresolved: 2 } as const;
  return [...rows.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

function SymbolGroups({ file, index }: { file: FileNode; index: GraphIndex }) {
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);
  const groups = useMemo(() => {
    const byKind = new Map<SymbolNode["kind"], SymbolNode[]>();
    for (const id of file.symbolIds) {
      const symbol = index.symbolsById.get(id);
      if (!symbol) continue;
      const list = byKind.get(symbol.kind);
      if (list) list.push(symbol);
      else byKind.set(symbol.kind, [symbol]);
    }
    return SYMBOL_KIND_ORDER.flatMap((kind) => {
      const symbols = byKind.get(kind);
      return symbols ? [{ kind, symbols }] : [];
    });
  }, [file, index]);

  if (groups.length === 0) {
    return <p className="text-xs text-ink-subtle">{file.status === "parsed" || file.status === "partial" ? "No symbols declared." : "Symbols are only extracted from parsed files."}</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map(({ kind, symbols }) => (
        <div key={kind}>
          <p className="mb-1 text-[11px] text-ink-subtle">
            {SYMBOL_KIND_LABELS[kind].plural} <span className="font-mono">{formatInteger(symbols.length)}</span>
          </p>
          <ExpandableList
            items={symbols}
            initial={10}
            getKey={(symbol) => symbol.id}
            renderItem={(symbol) => (
              <div className={symbol.parentSymbolId ? "flex items-center gap-2 pl-3" : "flex items-center gap-2"}>
                <NodeLink nodeRef={{ kind: "symbol", id: symbol.id }} className="font-mono text-xs text-ink" title={symbol.signature}>
                  {symbol.name}
                </NodeLink>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-subtle">L{symbol.startLine}</span>
                <button
                  type="button"
                  onClick={() => openCodeViewer({ fileId: symbol.fileId, line: symbol.startLine, endLine: symbol.endLine })}
                  aria-label={`View source of ${symbol.name}, ${lineRangeLabel(symbol)}`}
                  className="shrink-0 rounded p-0.5 text-ink-subtle transition-colors hover:text-signal"
                >
                  <Eye aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            )}
          />
        </div>
      ))}
    </div>
  );
}

export function FileDetails({ file, index }: { file: FileNode; index: GraphIndex }) {
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);
  const setVisualMode = useExplorerStore((state) => state.setVisualMode);
  const toggleDependencies = useExplorerStore((state) => state.toggleDependencies);
  const issueCameraCommand = useExplorerStore((state) => state.issueCameraCommand);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const repository = index.graph.repository;
  const history = index.graph.analysis.history;

  const counts = useMemo(() => countFileSymbols(file, index), [file, index]);
  const imports = useMemo(() => collectImports(file, index), [file, index]);
  const dependents = useMemo(() => dependentFileIds(file.id, index), [file, index]);
  const statusCopy = FILE_STATUS_COPY[file.status];
  const activity = file.activity;
  const contributors = (activity?.contributorIds ?? [])
    .map((id) => index.contributorsById.get(id))
    .filter((contributor) => contributor !== undefined)
    .slice(0, 5);
  const canViewSource = file.status !== "binary";

  const focusDependencyGraph = (sectionId: string) => {
    setVisualMode("dependencies");
    toggleDependencies(true);
    issueCameraCommand({ type: "focus-node", ref: { kind: "file", id: file.id } });
    scrollToSection(sectionId, reducedMotion);
  };

  return (
    <div>
      <PathBreadcrumb path={file.path} index={index} />

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <LanguageDot language={file.language} />
        <span>{fileSummaryLine(file)}</span>
        {file.linesEstimated ? (
          <Badge tone="warn" title="Estimated from the file size because the content was not downloaded">
            estimated
          </Badge>
        ) : null}
        {file.isGenerated ? <Badge tone="neutral">generated</Badge> : null}
        <span className="text-ink-subtle">· {formatBytes(file.size)}</span>
      </p>

      {file.status !== "parsed" ? (
        <div className="mt-3 rounded-lg border border-line-strong bg-abyss/60 p-2.5 text-xs">
          <Badge tone={statusCopy.tone}>{statusCopy.label}</Badge>
          <p className="mt-1.5 leading-relaxed text-ink-muted">{file.statusReason ?? statusCopy.explanation}</p>
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-4 gap-1.5">
        <StatTile label="Functions" value={formatInteger(counts.functions)} hint="Functions and methods" />
        <StatTile label="Classes" value={formatInteger(counts.classes)} hint="Classes and structs" />
        <StatTile label="Imports" value={formatInteger(file.imports.length)} />
        <StatTile label="Dependents" value={formatInteger(dependents.length)} hint="Files that import this file" />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton icon={<Code />} onClick={() => openCodeViewer({ fileId: file.id })} disabled={!canViewSource} title={canViewSource ? "Shortcut: V" : "Binary files have no source view"}>
          View source
        </ActionButton>
        <ActionLink
          icon={<GitHubMark />}
          href={githubBlobUrl(repository.owner, repository.name, repository.commitSha, file.path)}
          label="Open on GitHub"
        />
        <ActionButton icon={<ArrowUpRight />} onClick={() => focusDependencyGraph(IMPORTS_SECTION_ID)} disabled={imports.length === 0}>
          Focus dependencies
        </ActionButton>
        <ActionButton icon={<ArrowDownLeft />} onClick={() => focusDependencyGraph(DEPENDENTS_SECTION_ID)} disabled={dependents.length === 0}>
          Focus dependents
        </ActionButton>
        <CopyButton text={file.path} label="Copy path" />
      </div>

      <PanelSection title="Activity">
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-subtle">Last modified</dt>
            <dd className="text-right text-ink" title={activity?.lastModified ? formatDate(activity.lastModified) : undefined}>
              {activity?.lastModified
                ? formatRelativeTime(activity.lastModified)
                : history.commitsFetched === 0
                  ? "History unavailable"
                  : "Unknown"}
            </dd>
          </div>
          {activity ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-subtle">Commits</dt>
              <dd className="text-right font-mono text-ink" title="Within the analysed history window">
                {formatInteger(activity.commitCount)}
              </dd>
            </div>
          ) : null}
        </dl>
        {contributors.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5" aria-label="Top contributors">
            {contributors.map((contributor) => (
              <li key={contributor.id}>
                <ContributorChip name={contributor.name} login={contributor.login} avatarUrl={contributor.avatarUrl} />
              </li>
            ))}
          </ul>
        ) : null}
      </PanelSection>

      <PanelSection title={<Fragment>Symbols <span className="font-mono">{formatInteger(counts.total)}</span></Fragment>}>
        <SymbolGroups file={file} index={index} />
      </PanelSection>

      <PanelSection id={IMPORTS_SECTION_ID} title={<Fragment>Imports <span className="font-mono">{formatInteger(imports.length)}</span></Fragment>}>
        {imports.length === 0 ? (
          <p className="text-xs text-ink-subtle">No imports found.</p>
        ) : (
          <ExpandableList
            items={imports}
            getKey={(row) => row.key}
            renderItem={(row) =>
              row.resolvedFileId ? (
                <NodeLink nodeRef={{ kind: "file", id: row.resolvedFileId }} className="block w-full font-mono text-xs" title={row.label}>
                  {row.label}
                </NodeLink>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-xs text-ink-muted" title={row.label}>
                    {row.label}
                  </span>
                  <Badge tone={row.kind === "external" ? "ion" : "neutral"} className="ml-auto shrink-0">
                    {row.kind}
                  </Badge>
                </span>
              )
            }
          />
        )}
      </PanelSection>

      <PanelSection id={DEPENDENTS_SECTION_ID} title={<Fragment>Dependents <span className="font-mono">{formatInteger(dependents.length)}</span></Fragment>}>
        {dependents.length === 0 ? (
          <p className="text-xs text-ink-subtle">No files in the graph import this file.</p>
        ) : (
          <ExpandableList
            items={dependents}
            getKey={(id) => id}
            renderItem={(id) => (
              <NodeLink nodeRef={{ kind: "file", id }} className="block w-full font-mono text-xs" title={index.filesById.get(id)?.path}>
                {index.filesById.get(id)?.path ?? id}
              </NodeLink>
            )}
          />
        )}
      </PanelSection>

      {history.commitsFetched > 0 && !history.perFileHistory && !activity?.lastModified ? (
        <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
          Activity is derived from the {pluralize(history.commitsFetched, "most recent commit")} only.
        </p>
      ) : null}
    </div>
  );
}
