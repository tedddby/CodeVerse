import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Tooltip, type TooltipAlign, type TooltipSide } from "./tooltip";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  /** Keyboard shortcut displayed in the tooltip, e.g. "F". */
  shortcut?: string;
  /** Renders as a toggle (aria-pressed). */
  pressed?: boolean;
  icon: ReactNode;
  size?: "sm" | "md";
  tooltipSide?: TooltipSide;
  /** Use "end" for buttons near the right screen edge so the tooltip stays on screen. */
  tooltipAlign?: TooltipAlign;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    shortcut,
    pressed,
    icon,
    size = "md",
    tooltipSide = "bottom",
    tooltipAlign,
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} align={tooltipAlign}>
      <button
        ref={ref}
        type={type}
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-pressed={pressed}
        className={cn(
          "inline-flex items-center justify-center rounded-lg border transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
          size === "md" ? "size-9" : "size-7",
          pressed
            ? "border-signal/50 bg-signal/12 text-signal"
            : "text-ink-muted hover:border-line-strong hover:bg-panel-raised hover:text-ink border-transparent",
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className="flex [&>svg]:size-[18px]">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
});
