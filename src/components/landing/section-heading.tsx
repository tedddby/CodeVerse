import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionHeadingProps {
  /** Id of the heading, referenced by the section's aria-labelledby. */
  id: string;
  /** Two-digit section index shown before the eyebrow, e.g. "02". */
  index: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Monospace eyebrow + H2 + lede, shared by every landing section. */
export function SectionHeading({
  id,
  index,
  eyebrow,
  title,
  children,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <p className="text-signal flex items-center gap-3 font-mono text-[11px] tracking-[0.22em] uppercase">
        <span className="text-ink-muted">{index}</span>
        <span aria-hidden="true" className="bg-line-strong h-px w-6" />
        {eyebrow}
      </p>
      <h2
        id={id}
        className="text-ink mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
      >
        {title}
      </h2>
      {children ? (
        <div className="text-ink-muted mt-4 text-base leading-relaxed text-pretty">{children}</div>
      ) : null}
    </div>
  );
}
