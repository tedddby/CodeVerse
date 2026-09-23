import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface TooltipProps {
  content: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  className?: string;
}

const sideClasses: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * CSS-only tooltip shown on hover and keyboard focus. Decorative: the wrapped
 * control must carry its own accessible name (aria-label), so the tooltip is aria-hidden.
 */
export function Tooltip({ content, shortcut, side = "bottom", children, className }: TooltipProps) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-panel-raised px-2 py-1 text-xs text-ink opacity-0 shadow-lg transition-opacity delay-300 duration-150 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100",
          sideClasses[side],
        )}
      >
        {content}
        {shortcut ? <kbd className="kbd">{shortcut}</kbd> : null}
      </span>
    </span>
  );
}
