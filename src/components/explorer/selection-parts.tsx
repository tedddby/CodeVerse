"use client";

import { Check, ChevronRight, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SectionLabel } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import { directoryId, ROOT_DIRECTORY_ID } from "@/graph/model/ids";
import type { NodeRef } from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";
import { formatInteger, formatPercent } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { copyText } from "./clipboard";
import { initialsOf, isTrustedAvatarUrl } from "./node-descriptions";

/** Selects a node and flies the camera to it. */
export function useSelectAndFocus(): (ref: NodeRef) => void {
  const select = useExplorerStore((state) => state.select);
  return (ref) => select(ref, { focus: true });
}

export function PanelSection({ title, children, className, id }: { title: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mt-5 scroll-mt-4", className)}>
      <SectionLabel className="mb-2">{title}</SectionLabel>
      {children}
    </section>
  );
}

/** Text-like button that selects and focuses a node. */
export function NodeLink({ nodeRef, children, className, title }: { nodeRef: NodeRef; children: ReactNode; className?: string; title?: string }) {
  const selectAndFocus = useSelectAndFocus();
  return (
    <button
      type="button"
      title={title}
      onClick={() => selectAndFocus(nodeRef)}
      className={cn(
        "min-w-0 truncate rounded text-left text-ink-muted transition-colors hover:text-signal focus-visible:text-signal",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Clickable ancestor path ("acme-platform / src / auth"). Each directory
 * segment selects that directory and flies to it.
 */
export function PathBreadcrumb({ path, index, includeLast = false }: { path: string; index: GraphIndex; includeLast?: boolean }) {
  const segments = path === "" ? [] : path.split("/");
  const directorySegments = includeLast ? segments : segments.slice(0, -1);
  const crumbs: Array<{ id: string; label: string }> = [{ id: ROOT_DIRECTORY_ID, label: index.graph.repository.name }];
  directorySegments.forEach((segment, position) => {
    crumbs.push({ id: directoryId(directorySegments.slice(0, position + 1).join("/")), label: segment });
  });
  return (
    <nav aria-label="Path" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[11.5px]">
        {crumbs.map((crumb, position) => (
          <li key={crumb.id} className="flex min-w-0 items-center gap-1">
            {position > 0 ? <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-ink-subtle" /> : null}
            {index.directoriesById.has(crumb.id) ? (
              <NodeLink nodeRef={{ kind: "directory", id: crumb.id }} className="max-w-[12rem]">
                {crumb.label}
              </NodeLink>
            ) : (
              <span className="truncate text-ink-subtle">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Small stat tile; render several inside a <dl>. */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line/80 bg-abyss/60 px-2 py-2" title={hint}>
      <dt className="truncate text-[11px] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Button in the panel's action row. */
export function ActionButton({
  icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-panel-raised/60 px-2.5 text-xs text-ink-muted transition-colors hover:border-signal/40 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      <span aria-hidden="true" className="flex [&>svg]:size-3.5">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** External link styled like an ActionButton; always opens in a new tab without referrer/opener. */
export function ActionLink({ icon, href, label }: { icon: ReactNode; href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-panel-raised/60 px-2.5 text-xs text-ink-muted transition-colors hover:border-signal/40 hover:text-ink"
    >
      <span aria-hidden="true" className="flex [&>svg]:size-3.5">
        {icon}
      </span>
      {label}
    </a>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      icon={copied ? <Check /> : <Copy />}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_800);
        });
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </ActionButton>
  );
}

/** List that shows the first `initial` items with a "Show N more" toggle. */
export function ExpandableList<T>({
  items,
  initial = 8,
  renderItem,
  getKey,
  className,
  noun = "more",
}: {
  items: readonly T[];
  initial?: number;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  className?: string;
  noun?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initial);
  const hidden = items.length - visible.length;
  return (
    <>
      <ul className={cn("space-y-0.5", className)}>
        {visible.map((item) => (
          <li key={getKey(item)}>{renderItem(item)}</li>
        ))}
      </ul>
      {hidden > 0 || (expanded && items.length > initial) ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 rounded text-xs text-ink-subtle transition-colors hover:text-signal"
        >
          {expanded ? "Show fewer" : `Show ${formatInteger(hidden)} ${noun}`}
        </button>
      ) : null}
    </>
  );
}

/** Contributor chip with a GitHub avatar (trusted CDN only) or initials. */
export function ContributorChip({ name, login, avatarUrl, detail }: { name: string; login?: string; avatarUrl?: string; detail?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {isTrustedAvatarUrl(avatarUrl) ? (
        // A plain <img>: avatars come from GitHub's CDN (allowed by the CSP); no referrer is sent.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-5 shrink-0 rounded-full border border-line-strong bg-panel-raised"
        />
      ) : (
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-panel-raised text-[9px] font-semibold text-ink-muted">
          {initialsOf(name)}
        </span>
      )}
      <span className="min-w-0 truncate text-xs text-ink">{login ?? name}</span>
      {detail ? <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{detail}</span> : null}
    </span>
  );
}

/** Horizontal stacked bar of language shares with a legend. */
export function LanguageBreakdown({ languageBytes, limit = 6 }: { languageBytes: Record<string, number>; limit?: number }) {
  const entries = Object.entries(languageBytes)
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total === 0) return <p className="text-xs text-ink-subtle">No language data.</p>;
  const top = entries.slice(0, limit);
  const otherBytes = entries.slice(limit).reduce((sum, [, bytes]) => sum + bytes, 0);
  const segments = top.map(([id, bytes]) => ({ id, name: getLanguage(id).name, color: getLanguage(id).color, share: bytes / total }));
  if (otherBytes > 0) segments.push({ id: "__other", name: "Other", color: "#627089", share: otherBytes / total });

  return (
    <div>
      <div
        role="img"
        aria-label={segments.map((segment) => `${segment.name} ${formatPercent(segment.share)}`).join(", ")}
        className="flex h-2 w-full overflow-hidden rounded-full bg-line"
      >
        {segments.map((segment) => (
          <span key={segment.id} className="h-full" style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.id} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="min-w-0 truncate text-ink-muted">{segment.name}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-subtle">{formatPercent(segment.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
