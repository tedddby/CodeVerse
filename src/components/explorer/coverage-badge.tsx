"use client";

import { ChevronDown, History, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { buildCoverageSummary, staleAnalysisNotice } from "./coverage-model";

/**
 * One calm line under the coverage badge when an earlier analysis is shown
 * because GitHub could not confirm the latest commit (STALE_ANALYSIS). The
 * badge's popover repeats it with the reason.
 */
export function StaleAnalysisNotice({ className }: { className?: string }) {
  const analysis = useExplorerStore((state) => state.graph?.analysis ?? null);
  const notice = useMemo(() => (analysis ? staleAnalysisNotice(analysis) : null), [analysis]);
  if (!notice) return null;
  return (
    <p
      role="status"
      className={cn(
        "glass text-ink-muted animate-fade-in flex max-w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-snug",
        className,
      )}
    >
      <History aria-hidden="true" className="text-signal mt-px size-3.5 shrink-0" />
      <span>{notice}</span>
    </p>
  );
}

/**
 * Honest analysis coverage ("Parsed 1,500 of 12,482 files") with a popover
 * listing exactly what was left out and why.
 */
export function CoverageBadge({ className }: { className?: string }) {
  const analysis = useExplorerStore((state) => state.graph?.analysis ?? null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const summary = useMemo(() => (analysis ? buildCoverageSummary(analysis) : null), [analysis]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  if (!summary) return null;
  const Icon = summary.complete ? ShieldCheck : ShieldAlert;

  return (
    <div
      ref={containerRef}
      className={cn("pointer-events-auto relative", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Close only the popover; keep the global Escape cascade from also clearing the selection.
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "glass hover:border-line-strong inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors",
          summary.complete ? "text-ok" : "text-warn",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="text-ink">{summary.headline}</span>
        <span className="text-ink-subtle max-sm:hidden">· {summary.tierLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("text-ink-subtle size-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Analysis coverage"
          className="glass animate-slide-up absolute top-full left-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-4 shadow-2xl"
        >
          <p className="text-ink text-sm font-semibold">{summary.tierLabel}</p>
          <p className="text-ink-muted mt-1 text-xs leading-relaxed">{summary.tierDescription}</p>
          {summary.freshness ? (
            <div className="border-line-strong bg-abyss/60 mt-3 rounded-lg border p-2.5 text-xs leading-relaxed">
              <p className="text-ink flex gap-2">
                <History aria-hidden="true" className="text-signal mt-0.5 size-3.5 shrink-0" />
                {summary.freshness.notice}
              </p>
              {summary.freshness.details.map((detail) => (
                <p key={detail} className="text-ink-muted mt-1">
                  {detail}
                </p>
              ))}
            </div>
          ) : null}
          <dl className="mt-3 space-y-1">
            {summary.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 text-xs">
                <dt className="text-ink-subtle">{row.label}</dt>
                <dd className="text-ink text-right font-mono tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
          {summary.notices.length > 0 ? (
            <ul className="border-line/80 mt-3 space-y-1.5 border-t pt-3">
              {summary.notices.map((notice) => (
                <li key={notice} className="text-ink-muted flex gap-2 text-xs leading-relaxed">
                  <span aria-hidden="true" className="text-warn">
                    !
                  </span>
                  {notice}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-line/80 text-ok mt-3 border-t pt-3 text-xs">
              Nothing was left out.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
