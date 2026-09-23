"use client";

import { FileLock, FileText } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { githubBlobUrl, sourceApiUrl } from "@/analysis/source-protocol";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { FileNode, SymbolNode } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { formatInteger } from "@/lib/utils/format";
import { useExplorerStore, type CodeViewerState } from "@/state/explorer-store";
import { CodeView, type ScrollRequest } from "./code-view";
import { CodeViewerHeader } from "./code-viewer-header";
import { CodeSkeleton, SourceErrorState, SourceMessage } from "./code-viewer-states";
import { loadShikiHighlighter, type HighlighterLoader } from "./highlighter";
import { shikiLanguageFor } from "./language-map";
import { MAX_HIGHLIGHTED_LINES, splitSourceLines } from "./source-lines";
import { buildOutline, symbolAtLine, SymbolOutline } from "./symbol-outline";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { useHighlightedLines, type HighlightState } from "./use-highlighted-lines";
import { useSourceFile, type SourceFileState } from "./use-source-file";

export interface CodeViewerProps {
  /**
   * Highlighter factory. Defaults to Shiki, loaded on first open via dynamic
   * import; tests inject a synchronous fake.
   */
  loadHighlighter?: HighlighterLoader;
}

/**
 * Right-hand source slide-over. Opens whenever `store.codeViewer` is set,
 * lazily fetches the file at the analysed commit and highlights it progressively.
 * Esc or the close button calls `store.closeCodeViewer()`.
 */
export function CodeViewer({ loadHighlighter = loadShikiHighlighter }: CodeViewerProps = {}) {
  const request = useExplorerStore((state) => state.codeViewer);
  const index = useExplorerStore((state) => state.index);
  const file = request && index ? index.filesById.get(request.fileId) : undefined;
  const isOpen = Boolean(request && index && file);

  // Restore focus to whatever was focused before the viewer opened.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous && previous !== document.body && document.contains(previous))
        previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // Esc closes the viewer unless a modal on top of it handles the key.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const state = useExplorerStore.getState();
      if (state.panels.search || state.panels.shortcuts || state.panels.share) return;
      event.preventDefault();
      state.closeCodeViewer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (!request || !index || !file) return null;
  return (
    <CodeViewerPanel
      key={file.id}
      index={index}
      file={file}
      request={request}
      loadHighlighter={loadHighlighter}
    />
  );
}

interface CodeViewerPanelProps {
  index: GraphIndex;
  file: FileNode;
  request: CodeViewerState;
  loadHighlighter: HighlighterLoader;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function CodeViewerPanel({ index, file, request, loadHighlighter }: CodeViewerPanelProps) {
  const repository = index.graph.repository;
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const closeCodeViewer = useExplorerStore((state) => state.closeCodeViewer);
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);
  const select = useExplorerStore((state) => state.select);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);

  const isGitHub = repository.provider === "github";
  const url = isGitHub
    ? sourceApiUrl(repository.owner, repository.name, repository.commitSha, file.path)
    : null;
  const { state, retry } = useSourceFile(url);
  const content = state.status === "ready" ? state.file.content : null;
  const lines = useMemo(() => (content === null ? null : splitSourceLines(content)), [content]);
  const language = useMemo(
    () => shikiLanguageFor(file.language, file.path),
    [file.language, file.path],
  );
  const highlight = useHighlightedLines(lines, language, loadHighlighter, MAX_HIGHLIGHTED_LINES);
  const { state: copyState, copy } = useCopyToClipboard();

  const githubUrl = isGitHub
    ? githubBlobUrl(
        repository.owner,
        repository.name,
        repository.commitSha,
        file.path,
        request.line,
        request.endLine,
      )
    : null;
  const outline = useMemo(
    () => buildOutline(file.symbolIds.map((id) => index.symbolsById.get(id)).filter(isDefined)),
    [file.symbolIds, index.symbolsById],
  );
  const activeSymbol = symbolAtLine(outline, request.line);
  // A new request object (even for the same line) scrolls again.
  const scrollRequest = useMemo<ScrollRequest | null>(
    () =>
      request.line ? { line: request.line, key: `${request.line}:${request.endLine ?? ""}` } : null,
    [request],
  );

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const onSelectSymbol = useCallback(
    (symbol: SymbolNode) => {
      openCodeViewer({ fileId: file.id, line: symbol.startLine, endLine: symbol.endLine });
      select({ kind: "symbol", id: symbol.id });
    },
    [file.id, openCodeViewer, select],
  );

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-40 flex flex-col overflow-hidden border border-line-strong bg-abyss shadow-2xl outline-none",
        "md:inset-y-3 md:right-3 md:left-auto md:w-[min(58vw,72rem)] md:rounded-2xl",
        !reducedMotion && "animate-slide-in-right",
      )}
    >
      <CodeViewerHeader
        titleId={titleId}
        file={file}
        lineCount={lines?.length ?? file.lines}
        size={state.status === "ready" ? state.file.size : file.size}
        commitSha={repository.commitSha}
        githubUrl={githubUrl}
        canCopy={content !== null}
        copyState={copyState}
        onCopy={() => {
          if (content !== null) void copy(content);
        }}
        outline={{
          available: outline.length > 0,
          open: outlineOpen,
          toggle: () => setOutlineOpen((open) => !open),
        }}
        onClose={closeCodeViewer}
        closeButtonRef={closeButtonRef}
      />
      <div className="flex min-h-0 flex-1">
        {outline.length > 0 && outlineOpen ? (
          <aside className="border-line/70 bg-abyss/40 hidden w-60 shrink-0 flex-col border-r lg:flex">
            <SymbolOutline
              outline={outline}
              activeSymbolId={activeSymbol?.id ?? null}
              onSelect={onSelectSymbol}
            />
          </aside>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <CodeViewerBody
            isGitHub={isGitHub}
            state={state}
            lines={lines}
            highlight={highlight}
            request={request}
            scrollRequest={scrollRequest}
            githubUrl={githubUrl}
            filePath={file.path}
            onRetry={retry}
            animate={!reducedMotion}
          />
        </div>
      </div>
      <StatusBar
        state={state}
        lines={lines}
        highlight={highlight}
        hasGrammar={language !== null}
        request={request}
      />
    </section>
  );
}

interface CodeViewerBodyProps {
  isGitHub: boolean;
  state: SourceFileState;
  lines: readonly string[] | null;
  highlight: HighlightState;
  request: CodeViewerState;
  scrollRequest: ScrollRequest | null;
  githubUrl: string | null;
  filePath: string;
  onRetry: () => void;
  animate: boolean;
}

function CodeViewerBody({
  isGitHub,
  state,
  lines,
  highlight,
  request,
  scrollRequest,
  githubUrl,
  filePath,
  onRetry,
  animate,
}: CodeViewerBodyProps) {
  if (!isGitHub) {
    return (
      <SourceMessage
        icon={FileLock}
        title="Source isn't available for this repository."
        message="The source viewer reads files from GitHub at the analysed commit. This repository did not come from GitHub."
      />
    );
  }
  if (state.status === "error")
    return <SourceErrorState error={state.error} githubUrl={githubUrl} onRetry={onRetry} />;
  if (state.status !== "ready" || !lines) return <CodeSkeleton animate={animate} />;
  if (lines.length === 0)
    return (
      <SourceMessage
        icon={FileText}
        title="This file is empty."
        message="There is nothing to display."
      />
    );
  return (
    <CodeView
      lines={lines}
      tokens={highlight.tokens}
      highlightStart={request.line}
      highlightEnd={request.endLine}
      scrollRequest={scrollRequest}
      label={`Source code of ${filePath}`}
    />
  );
}

function StatusBar({
  state,
  lines,
  highlight,
  hasGrammar,
  request,
}: {
  state: SourceFileState;
  lines: readonly string[] | null;
  highlight: HighlightState;
  hasGrammar: boolean;
  request: CodeViewerState;
}) {
  let message = "";
  if (state.status === "loading") message = "Loading source…";
  else if (state.status === "ready" && lines && lines.length > 0) {
    if (!hasGrammar) message = "Plain text";
    else if (highlight.status === "loading") message = "Loading syntax highlighting…";
    else if (highlight.status === "highlighting")
      message = `Highlighting… ${formatInteger(highlight.tokens.length)} / ${formatInteger(highlight.target)} lines`;
    else if (highlight.status === "plain")
      message = "Syntax highlighting unavailable — showing plain text";
    else if (lines.length > highlight.target)
      message = `Highlighted the first ${formatInteger(highlight.target)} of ${formatInteger(lines.length)} lines`;
    else message = "Highlighted";
  }
  return (
    <footer className="border-line/70 text-ink-subtle flex h-8 shrink-0 items-center justify-between gap-3 border-t px-4 font-mono text-[10.5px]">
      <span className="truncate">{message}</span>
      {request.line ? (
        <span className="text-flare/90 shrink-0">
          {request.endLine && request.endLine !== request.line
            ? `Lines ${formatInteger(request.line)}–${formatInteger(request.endLine)}`
            : `Line ${formatInteger(request.line)}`}
        </span>
      ) : null}
    </footer>
  );
}
