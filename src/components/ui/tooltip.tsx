import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";
/** Horizontal alignment for top/bottom tooltips; `end` keeps controls at the right screen edge readable. */
export type TooltipAlign = "start" | "center" | "end";

export interface TooltipProps {
  content: string;
  shortcut?: string;
  side?: TooltipSide;
  align?: TooltipAlign;
  children: ReactNode;
  className?: string;
}

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const alignClasses: Record<TooltipAlign, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

/**
 * CSS-only tooltip shown on hover and keyboard focus. Decorative: the wrapped
 * control must carry its own accessible name (aria-label), so the tooltip is aria-hidden.
 */
export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  align = "center",
  children,
  className,
}: TooltipProps) {
  const vertical = side === "top" || side === "bottom";
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "border-line-strong bg-panel-raised text-ink pointer-events-none absolute z-50 flex items-center gap-2 rounded-md border px-2 py-1 text-xs whitespace-nowrap opacity-0 shadow-lg transition-opacity delay-300 duration-150 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100",
          sideClasses[side],
          vertical && alignClasses[align],
        )}
      >
        {content}
        {shortcut ? <kbd className="kbd">{shortcut}</kbd> : null}
      </span>
    </span>
  );
}
