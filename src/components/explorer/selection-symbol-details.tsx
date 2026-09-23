"use client";

import { Code, FileCode } from "lucide-react";
import { useMemo } from "react";
import { githubBlobUrl } from "@/analysis/source-protocol";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { SymbolNode } from "@/graph/model/types";
import { useExplorerStore } from "@/state/explorer-store";
import { GitHubMark } from "@/components/brand/github-mark";
import { SYMBOL_KIND_LABELS, lineRangeLabel } from "./node-descriptions";
import { ActionButton, ActionLink, ExpandableList, NodeLink, PanelSection, PathBreadcrumb } from "./selection-parts";

export function SymbolDetails({ symbol, index }: { symbol: SymbolNode; index: GraphIndex }) {
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);
  const select = useExplorerStore((state) => state.select);
  const file = index.filesById.get(symbol.fileId);
  const parent = symbol.parentSymbolId ? index.symbolsById.get(symbol.parentSymbolId) : undefined;
  const repository = index.graph.repository;

  const members = useMemo(() => {
    if (!file) return [];
    return file.symbolIds
      .map((id) => index.symbolsById.get(id))
      .filter((candidate): candidate is SymbolNode => candidate?.parentSymbolId === symbol.id);
  }, [file, index, symbol.id]);

  return (
    <div>
      {file ? <PathBreadcrumb path={file.path} index={index} includeLast={false} /> : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-muted">{lineRangeLabel(symbol)}</span>
        {symbol.exported ? <Badge tone="signal">exported</Badge> : null}
      </div>

      {file ? (
        <p className="mt-2 flex min-w-0 items-center gap-2 text-xs text-ink-subtle">
          <LanguageDot language={file.language} />
          <span className="shrink-0">in</span>
          <NodeLink nodeRef={{ kind: "file", id: file.id }} className="font-mono text-xs" title={file.path}>
            {file.path}
          </NodeLink>
        </p>
      ) : null}

      {parent ? (
        <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-subtle">
          <span className="shrink-0">member of</span>
          <NodeLink nodeRef={{ kind: "symbol", id: parent.id }} className="font-mono text-xs">
            {parent.name}
          </NodeLink>
        </p>
      ) : null}

      {symbol.signature ? (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line/80 bg-abyss/70 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink">
          {symbol.signature}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton
          icon={<Code />}
          onClick={() => openCodeViewer({ fileId: symbol.fileId, line: symbol.startLine, endLine: symbol.endLine })}
          disabled={!file}
          title="Shortcut: V"
        >
          View source
        </ActionButton>
        {file ? (
          <ActionLink
            icon={<GitHubMark />}
            href={githubBlobUrl(repository.owner, repository.name, repository.commitSha, file.path, symbol.startLine, symbol.endLine)}
            label="Open on GitHub"
          />
        ) : null}
        {file ? (
          <ActionButton icon={<FileCode />} onClick={() => select({ kind: "file", id: file.id })}>
            Select file
          </ActionButton>
        ) : null}
      </div>

      {members.length > 0 ? (
        <PanelSection title="Members">
          <ExpandableList
            items={members}
            getKey={(member) => member.id}
            renderItem={(member) => (
              <span className="flex min-w-0 items-center gap-2">
                <NodeLink nodeRef={{ kind: "symbol", id: member.id }} className="font-mono text-xs text-ink" title={member.signature}>
                  {member.name}
                </NodeLink>
                <span className="ml-auto shrink-0 text-[10.5px] text-ink-subtle">{SYMBOL_KIND_LABELS[member.kind].singular}</span>
              </span>
            )}
          />
        </PanelSection>
      ) : null}
    </div>
  );
}
