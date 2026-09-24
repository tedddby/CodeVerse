import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  /** "navy" for the deep developer section. */
  tone?: "light" | "navy";
  align?: "start" | "center";
  className?: string;
}

/** Eyebrow in the accent color, a tight navy headline and calm body copy. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
  tone = "light",
  align = "start",
  className,
}: SectionHeadingProps) {
  const navy = tone === "navy";
  return (
    <div className={cn("max-w-[42rem]", align === "center" && "mx-auto text-center", className)}>
      <p
        className={cn(
          "text-[15px] font-semibold tracking-[-0.005em]",
          navy ? "text-[#9fe8ff]" : "text-(--lc-accent)",
        )}
      >
        {eyebrow}
      </p>
      <h2
        id={id}
        className={cn(
          "mt-3 text-[clamp(2rem,1.35rem+2.1vw,3rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance",
          navy ? "text-white" : "text-(--lc-ink)",
        )}
      >
        {title}
      </h2>
      {children ? (
        <div
          className={cn(
            "mt-5 text-[17px] leading-[1.65] text-pretty sm:text-lg",
            navy ? "text-[#b7c1d6]" : "text-(--lc-body)",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
