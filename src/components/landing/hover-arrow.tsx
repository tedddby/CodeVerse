import { cn } from "@/lib/utils/cn";

/**
 * A chevron whose stem draws in when the parent `group` is hovered or focused,
 * turning "›" into "→". `solid` keeps the stem visible (a plain arrow).
 */
export function HoverArrow({ solid = false, className }: { solid?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width={10}
      height={10}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 overflow-visible", className)}
    >
      <path
        d="M0.5 5h7"
        className={cn(
          "transition-opacity duration-150",
          solid
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      />
      <path
        d="M4 1.5 7.5 5 4 8.5"
        className={cn(
          "transition-transform duration-150",
          !solid &&
            "-translate-x-[3px] group-hover:translate-x-0 group-focus-visible:translate-x-0",
        )}
      />
    </svg>
  );
}
