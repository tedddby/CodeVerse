"use client";

import { Code, ExternalLink } from "lucide-react";
import { useId } from "react";
import { githubBlobUrl } from "@/analysis/source-protocol";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { NodeIcon, SYMBOL_KIND_LABELS } from "@/components/search/node-icon";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge, LanguageDot, Stat } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, NodeRef, RepositoryInfo } from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { formatBytes, formatInteger, formatRelativeTime } from "@/lib/utils/format";
import { DetailsSection } from "./details-section";
import { DirectoryDetails } from "./summary-directory-details";

/** How many list entries (symbols, imports, dependents) are shown before truncating. */
const LIST_LIMIT = 60;

const STATUS_COPY: Record<FileNode["status"], string> = {
  parsed: "Parsed",
  partial: "Parsed with syntax errors",
  "content-only": "Line-counted (no parser for this language)",
  "metadata-only": "Metadata only (content not downloaded)",
  binary: "Binary",
  failed: "Analysis failed",
};

export interface SummaryDetailsProps {
  index: GraphIndex;
  selection: NodeRef | null;
  onNavigate: (fileId: string) => void;
  onViewSource: (fileId: string, line?: number, endLine?: number) => void;
}

/** Details of the node selected in the repository tree. */
export function SummaryDetails({
  index,
  selection,
  onNavigate,
  onViewSource,
}: SummaryDetailsProps) {
  if (!selection) {
    return (
      <p className="text-ink-subtle text-sm">
        Select a file or directory in the tree to see its details.
      </p>
    );
  }
  if (selection.kind === "directory") {
    const directory = index.directoriesById.get(selection.id);
    return directory ? <DirectoryDetails index={index} directory={directory} /> : null;
  }
  const symbol = selection.kind === "symbol" ? index.symbolsById.get(selection.id) : undefined;
  const file = index.filesById.get(symbol ? symbol.fileId : selection.id);
  if (!file) return null;
  return (
    <FileDetails
      index={index}
      file={file}
      highlightedSymbolId={symbol?.id}
      onNavigate={onNavigate}
      onViewSource={onViewSource}
    />
  );
}

function FileLink({
  index,
  fileId,
  onNavigate,
}: {
  index: GraphIndex;
  fileId: string;
  onNavigate: (id: string) => void;
}) {
  const file = index.filesById.get(fileId);
  if (!file) return null;
  return (
    <button
      type="button"
      onClick={() => onNavigate(fileId)}
      className="text-ink-muted hover:bg-panel-raised hover:text-ink flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs"
    >
      <LanguageDot language={file.language} />
      <span className="truncate font-mono">{revealHiddenCharacters(file.path)}</span>
    </button>
  );
}

function isOnGitHub(repository: RepositoryInfo): boolean {
  return repository.provider === "github";
}

function FileDetails({
  index,
  file,
  highlightedSymbolId,
  onNavigate,
  onViewSource,
}: {
  index: GraphIndex;
  file: FileNode;
  highlightedSymbolId?: string;
  onNavigate: (fileId: string) => void;
  onViewSource: (fileId: string, line?: number, endLine?: number) => void;
}) {
  const { repository } = index.graph;
  const language = getLanguage(file.language);
  const symbols = file.symbolIds
    .map((id) => index.symbolsById.get(id))
    .filter((symbol) => symbol !== undefined);
  const internalImports = [
    ...new Set(file.imports.flatMap((ref) => (ref.resolvedFileId ? [ref.resolvedFileId] : []))),
  ];
  const externalImports = [
    ...new Set(file.imports.filter((ref) => ref.external).map((ref) => ref.specifier)),
  ];
  const dependents = (index.dependenciesByTarget.get(file.id) ?? []).map((edge) => edge.source);
  const canViewSource = file.status !== "binary" && isOnGitHub(repository);
  const activity = file.activity;
  const titleId = useId();
  const contributors = (activity?.contributorIds ?? [])
    .map((id) => index.contributorsById.get(id)?.name)
    .filter((name) => name !== undefined);

  return (
    <article aria-labelledby={titleId}>
      <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">File</p>
      <h3 id={titleId} className="text-ink mt-0.5 font-mono text-sm font-semibold break-all">
        {revealHiddenCharacters(file.path)}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge>
          <LanguageDot language={file.language} />
          {language.id === "unknown" ? "Other" : language.name}
        </Badge>
        <Badge
          tone={file.status === "parsed" ? "ok" : file.status === "failed" ? "danger" : "neutral"}
        >
          {STATUS_COPY[file.status]}
        </Badge>
        {file.isGenerated ? <Badge tone="warn">Generated</Badge> : null}
      </div>
      {file.statusReason ? (
        <p className="text-ink-subtle mt-1.5 text-xs">{file.statusReason}</p>
      ) : null}

      <dl className="mt-3 space-y-1">
        <Stat
          label="Lines"
          value={`${file.linesEstimated ? "~" : ""}${formatInteger(file.lines)}`}
          hint={file.linesEstimated ? "estimated" : undefined}
        />
        <Stat label="Size" value={formatBytes(file.size)} />
        <Stat label="Category" value={file.category} />
        {activity?.lastModified ? (
          <Stat label="Last changed" value={formatRelativeTime(activity.lastModified)} />
        ) : null}
        {activity ? (
          <Stat label="Commits (analysed window)" value={formatInteger(activity.commitCount)} />
        ) : null}
      </dl>
      {contributors.length > 0 ? (
        <p className="text-ink-subtle mt-1.5 text-xs">
          Touched by {revealHiddenCharacters(contributors.slice(0, 5).join(", "))}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canViewSource ? (
          <Button size="sm" onClick={() => onViewSource(file.id)}>
            <Code aria-hidden="true" className="size-3.5" />
            View source
          </Button>
        ) : null}
        {isOnGitHub(repository) ? (
          <ButtonLink
            href={githubBlobUrl(repository.owner, repository.name, repository.commitSha, file.path)}
            external
            size="sm"
            variant="ghost"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Open on GitHub
          </ButtonLink>
        ) : null}
      </div>

      {symbols.length > 0 ? (
        <DetailsSection label={`Symbols (${formatInteger(symbols.length)})`}>
          <ul className="space-y-px">
            {symbols.slice(0, LIST_LIMIT).map((symbol) => {
              const current = symbol.id === highlightedSymbolId;
              const content = (
                <>
                  <NodeIcon kind="symbol" symbolKind={symbol.kind} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {revealHiddenCharacters(symbol.name)}
                  </span>
                  <span className="sr-only">{SYMBOL_KIND_LABELS[symbol.kind]}, line</span>
                  <span className="text-ink-subtle shrink-0 font-mono text-[10.5px]">
                    L{symbol.startLine}
                  </span>
                </>
              );
              const rowClass = current
                ? "flex w-full items-center gap-2 rounded bg-flare/10 px-1 py-0.5 text-left text-xs text-ink"
                : "flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-ink-muted";
              return (
                <li key={symbol.id} aria-current={current ? "true" : undefined}>
                  {canViewSource ? (
                    <button
                      type="button"
                      title={`View ${escapeHiddenCharacters(symbol.name)} in the source`}
                      onClick={() => onViewSource(file.id, symbol.startLine, symbol.endLine)}
                      className={`${rowClass} hover:bg-panel-raised hover:text-ink`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={rowClass}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {symbols.length > LIST_LIMIT ? (
            <p className="text-ink-subtle mt-1 text-[11px]">
              +{formatInteger(symbols.length - LIST_LIMIT)} more
            </p>
          ) : null}
        </DetailsSection>
      ) : null}

      {internalImports.length > 0 || externalImports.length > 0 ? (
        <DetailsSection
          label={`Imports (${formatInteger(internalImports.length + externalImports.length)})`}
        >
          <ul>
            {internalImports.slice(0, LIST_LIMIT).map((id) => (
              <li key={id}>
                <FileLink index={index} fileId={id} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
          {externalImports.length > 0 ? (
            <ul aria-label="External packages" className="mt-1 flex flex-wrap gap-1">
              {externalImports.slice(0, LIST_LIMIT).map((specifier) => (
                <li
                  key={specifier}
                  className="border-line-strong text-ink-subtle rounded border px-1.5 font-mono text-[11px]"
                >
                  {revealHiddenCharacters(specifier)}
                </li>
              ))}
            </ul>
          ) : null}
        </DetailsSection>
      ) : null}

      {dependents.length > 0 ? (
        <DetailsSection label={`Imported by (${formatInteger(dependents.length)})`}>
          <ul>
            {dependents.slice(0, LIST_LIMIT).map((id) => (
              <li key={id}>
                <FileLink index={index} fileId={id} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
          {dependents.length > LIST_LIMIT ? (
            <p className="text-ink-subtle mt-1 text-[11px]">
              +{formatInteger(dependents.length - LIST_LIMIT)} more
            </p>
          ) : null}
        </DetailsSection>
      ) : null}
    </article>
  );
}
