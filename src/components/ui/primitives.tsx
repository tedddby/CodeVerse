import type { HTMLAttributes, ReactNode } from "react";
import { getLanguage } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

export type BadgeTone = "neutral" | "signal" | "ion" | "flare" | "ok" | "warn" | "danger";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-panel-raised text-ink-muted",
  signal: "border-signal/35 bg-signal/10 text-signal",
  ion: "border-ion/35 bg-ion/10 text-ion",
  flare: "border-flare/40 bg-flare/10 text-flare",
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-none tracking-wider uppercase",
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function LanguageDot({ language, className }: { language: string; className?: string }) {
  const info = getLanguage(language);
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: info.color, boxShadow: `0 0 0 1px ${info.color}33` }}
    />
  );
}

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** Label/value pair rendered as a description-list item; wrap several in a <dl>. */
export function Stat({ label, value, hint, className }: StatProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className="text-ink-subtle text-xs">{label}</dt>
      <dd className="text-ink text-right font-mono text-sm tabular-nums">
        {value}
        {hint ? <span className="text-ink-subtle ml-1.5 text-[11px]">{hint}</span> : null}
      </dd>
    </div>
  );
}

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label: string;
  tone?: "signal" | "ion" | "flare" | "ok";
  className?: string;
}

export function ProgressBar({ value, label, tone = "signal", className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const toneClass = { signal: "bg-signal", ion: "bg-ion", flare: "bg-flare", ok: "bg-ok" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("bg-line h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", toneClass)}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

/** Uppercase, letter-spaced section label used across panels. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-ink-subtle font-mono text-[10.5px] tracking-[0.18em] uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}
