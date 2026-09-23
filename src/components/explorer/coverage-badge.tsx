"use client";

import { ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { buildCoverageSummary } from "./coverage-model";

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
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) setOpen(false);
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
          "glass inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors hover:border-line-strong",
          summary.complete ? "text-ok" : "text-warn",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="text-ink">{summary.headline}</span>
        <span className="text-ink-subtle max-sm:hidden">· {summary.tierLabel}</span>
        <ChevronDown aria-hidden="true" className={cn("size-3 text-ink-subtle transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Analysis coverage"
          className="glass absolute left-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-4 shadow-2xl animate-slide-up"
        >
          <p className="text-sm font-semibold text-ink">{summary.tierLabel}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{summary.tierDescription}</p>
          <dl className="mt-3 space-y-1">
            {summary.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 text-xs">
                <dt className="text-ink-subtle">{row.label}</dt>
                <dd className="text-right font-mono tabular-nums text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
          {summary.notices.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-line/80 pt-3">
              {summary.notices.map((notice) => (
                <li key={notice} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                  <span aria-hidden="true" className="text-warn">
                    !
                  </span>
                  {notice}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border-t border-line/80 pt-3 text-xs text-ok">Nothing was left out.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
