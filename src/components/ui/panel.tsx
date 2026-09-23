import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PanelProps {
  /** Panel heading; also its accessible name. */
  title: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  onClose?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Landmark element; panels are complementary content by default. */
  as?: "aside" | "section" | "div";
  "aria-label"?: string;
}

/** Floating glass panel with a header, used for explorer side panels. */
export function Panel({
  title,
  eyebrow,
  onClose,
  actions,
  children,
  className,
  bodyClassName,
  as: Component = "aside",
  "aria-label": ariaLabel,
}: PanelProps) {
  return (
    <Component aria-label={ariaLabel} className={cn("glass flex max-h-full flex-col overflow-hidden rounded-2xl shadow-2xl", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line/80 px-4 py-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-subtle">{eyebrow}</p>
          ) : null}
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-panel-raised hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", bodyClassName)}>{children}</div>
    </Component>
  );
}
