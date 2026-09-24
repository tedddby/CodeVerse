"use client";

import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CoverageSection, LanguagesSection } from "@/components/panels/analytics-sections";
import { repositoryStats, safeHttpsUrl } from "@/components/panels/analytics-model";
import { IconButton } from "@/components/ui/icon-button";
import { Stat } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { SummaryDetails } from "./summary-details";
import { SummaryTree } from "./summary-tree";
import { ancestorsToReveal, revealPages, TREE_PAGE_SIZE, visibleRows } from "./summary-tree-model";

export interface RepositorySummaryProps {
  /**
   * Render as main page content (the fallback when WebGL is unavailable)
   * instead of a dismissible overlay opened via `panels.summary`.
   */
  standalone?: boolean;
}

/**
 * Accessible, semantic-HTML view of the repository: headline numbers,
 * languages, analysis coverage and a keyboard-navigable file tree with details.
 */
export function RepositorySummary({ standalone = false }: RepositorySummaryProps) {
  const open = useExplorerStore((state) => state.panels.summary);
  const index = useExplorerStore((state) => state.index);
  if (!index || (!standalone && !open)) return null;
  return standalone ? <StandaloneSummary index={index} /> : <SummaryOverlay index={index} />;
}

/**
 * Repository name, description and link. Standalone, the summary is the page's
 * main content and its name is the h1; inside the overlay it is an h2.
 */
function RepositoryHeading({ index, id, level }: { index: GraphIndex; id: string; level: 1 | 2 }) {
  const { repository } = index.graph;
  const url = safeHttpsUrl(repository.url);
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="min-w-0">
      <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
        Repository summary
      </p>
      <Heading
        id={id}
        className={cn("text-ink truncate font-semibold", level === 1 ? "text-2xl" : "text-lg")}
      >
        {repository.fullName}
      </Heading>
      {repository.description ? (
        <p className="text-ink-muted mt-1 max-w-3xl text-sm">{repository.description}</p>
      ) : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-signal mt-1 inline-flex items-center gap-1 text-xs hover:underline"
        >
          {url.replace(/^https:\/\//, "")}
          <ExternalLink aria-hidden="true" className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}

function StandaloneSummary({ index }: { index: GraphIndex }) {
  const titleId = useId();
  const webglAvailable = useExplorerStore((state) => state.webglAvailable);
  return (
    <article aria-labelledby={titleId} className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {webglAvailable === false ? (
        <p
          role="note"
          className="border-line-strong bg-panel/80 text-ink-muted mb-6 rounded-lg border px-4 py-3 text-sm"
        >
          The 3D view needs WebGL, which isn&apos;t available in this browser. Everything CodeVerse
          found is listed below.
        </p>
      ) : null}
      <RepositoryHeading index={index} id={titleId} level={1} />
      <SummaryContent index={index} sectionHeading="h2" />
    </article>
  );
}

function SummaryOverlay({ index }: { index: GraphIndex }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const reducedMotion = useExplorerStore((state) => state.reducedMotion);
  const close = useCallback(() => setPanel("summary", false), [setPanel]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous !== document.body && document.contains(previous))
        previous.focus({ preventScroll: true });
    };
  }, []);

  // Esc closes the summary unless something on top of it (source viewer, modal) takes the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const state = useExplorerStore.getState();
      if (state.codeViewer || state.panels.search || state.panels.shortcuts || state.panels.share)
        return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        // Focused on open: a signal border, not the global outline, shows keyboard focus.
        "glass focus-visible:border-signal/60 fixed inset-2 z-[35] flex flex-col overflow-hidden rounded-2xl shadow-2xl outline-none sm:inset-6",
        "lg:inset-x-[max(1.5rem,calc((100vw-80rem)/2))]",
        !reducedMotion && "animate-fade-in",
      )}
    >
      <div className="border-line/80 flex items-start justify-between gap-4 border-b px-5 py-3">
        <RepositoryHeading index={index} id={titleId} level={2} />
        <IconButton label="Close summary" shortcut="Esc" icon={<X />} onClick={close} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <SummaryContent index={index} sectionHeading="h3" />
      </div>
    </section>
  );
}

function SummaryContent({
  index,
  sectionHeading: Heading,
}: {
  index: GraphIndex;
  sectionHeading: "h2" | "h3";
}) {
  const stats = repositoryStats(index);
  const selection = useExplorerStore((state) => state.selection);
  const select = useExplorerStore((state) => state.select);
  const openCodeViewer = useExplorerStore((state) => state.openCodeViewer);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ id: string } | null>(null);
  const rows = useMemo(() => visibleRows(index, expanded, pages), [index, expanded, pages]);
  const filesHeadingId = useId();

  const selectedTreeId =
    selection?.kind === "symbol"
      ? (index.symbolsById.get(selection.id)?.fileId ?? null)
      : (selection?.id ?? null);

  const onToggle = useCallback((directoryId: string, expand: boolean) => {
    setExpanded((previous) => {
      if (previous.has(directoryId) === expand) return previous;
      const next = new Set(previous);
      if (expand) next.add(directoryId);
      else next.delete(directoryId);
      return next;
    });
  }, []);

  const onShowMore = useCallback((directoryId: string) => {
    setPages((previous) =>
      new Map(previous).set(
        directoryId,
        (previous.get(directoryId) ?? TREE_PAGE_SIZE) + TREE_PAGE_SIZE,
      ),
    );
  }, []);

  const onActivate = useCallback(
    (id: string, kind: "directory" | "file") => select({ kind, id }),
    [select],
  );

  // Jump to a file from the details pane: expand its ancestors, page it in, select and scroll to it.
  const onNavigate = (fileId: string) => {
    setExpanded((previous) => {
      const missing = ancestorsToReveal(index, fileId).filter((id) => !previous.has(id));
      return missing.length === 0 ? previous : new Set([...previous, ...missing]);
    });
    setPages((previous) => revealPages(index, fileId, previous));
    setFocusedId(fileId);
    setRevealRequest({ id: fileId });
    select({ kind: "file", id: fileId });
  };

  const onViewSource = useCallback(
    (fileId: string, line?: number, endLine?: number) => openCodeViewer({ fileId, line, endLine }),
    [openCodeViewer],
  );

  return (
    <div className="space-y-6">
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Stars" value={formatCompact(stats.stars)} />
        <Stat label="Forks" value={formatCompact(stats.forks)} />
        <Stat label="Files" value={formatInteger(stats.filesInRepository)} />
        <Stat label="Files analysed" value={formatInteger(stats.filesAnalysed)} />
        <Stat
          label="Lines of code"
          value={`${stats.linesEstimated ? "~" : ""}${formatCompact(stats.linesOfCode)}`}
        />
        <Stat label="Symbols" value={formatCompact(stats.symbols)} />
        <Stat label="Dependencies" value={formatCompact(stats.dependencies)} />
        <Stat label="External packages" value={formatInteger(stats.externalPackages)} />
        <Stat label="Contributors" value={formatInteger(stats.contributors)} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby={filesHeadingId} className="min-w-0">
          <Heading id={filesHeadingId} className="text-ink mb-2 text-sm font-semibold">
            Files
          </Heading>
          <p className="text-ink-subtle mb-2 text-xs">
            Arrow keys move, Right/Left expand and collapse, Enter selects, typing jumps to a name.
          </p>
          <div className="border-line/70 bg-abyss/40 max-h-[60vh] overflow-y-auto rounded-xl border p-1.5">
            <SummaryTree
              index={index}
              rows={rows}
              expanded={expanded}
              pages={pages}
              focusedId={focusedId}
              selectedId={selectedTreeId}
              label={`Files in ${index.graph.repository.fullName}`}
              onFocusChange={setFocusedId}
              onToggle={onToggle}
              onActivate={onActivate}
              onShowMore={onShowMore}
              revealRequest={revealRequest}
            />
          </div>
        </section>
        <aside
          aria-label="Selection details"
          className="border-line/70 bg-panel/50 min-w-0 rounded-xl border p-4 lg:self-start"
        >
          <SummaryDetails
            index={index}
            selection={selection}
            onNavigate={onNavigate}
            onViewSource={onViewSource}
          />
        </aside>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="border-line/70 bg-panel/50 rounded-xl border p-4">
          <LanguagesSection index={index} />
        </div>
        <div className="border-line/70 bg-panel/50 rounded-xl border p-4">
          <CoverageSection index={index} />
        </div>
      </div>
    </div>
  );
}
