import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { LogoMark } from "./logo-mark";

export interface LogoProps {
  className?: string;
  /** Classes for the mark (controls its size; defaults to 1.75rem). */
  markClassName?: string;
  /** Classes for the wordmark text. */
  wordmarkClassName?: string;
  /** Color separating the orbit from the tower; match the surface behind the logo. */
  knockout?: string;
}

/**
 * Horizontal lockup: the mark followed by the "CodeVerse" wordmark. The wordmark
 * is real text, so the lockup's accessible name is the product name and the
 * mark itself stays decorative.
 */
export function Logo({ className, markClassName, wordmarkClassName, knockout }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={cn("size-7 shrink-0", markClassName)} knockout={knockout} />
      <span
        className={cn(
          "text-ink text-[1.05rem] font-semibold tracking-[-0.02em]",
          wordmarkClassName,
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
