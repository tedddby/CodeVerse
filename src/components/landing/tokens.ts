import { cn } from "@/lib/utils/cn";

/** Page column: 1160px of content with 20px (phone) to 32px (desktop) gutters. */
export const CONTAINER = "mx-auto w-full max-w-[1224px] px-5 sm:px-8";

/** Vertical rhythm shared by the light sections. */
export const SECTION_SPACING = "py-24 sm:py-28 lg:py-32";

/** Ids of the in-page anchors, in document order. */
export const ANCHORS = {
  main: "main-content",
  demo: "demo",
  howItWorks: "how-it-works",
  features: "features",
  examples: "examples",
  openSource: "open-source",
} as const;

export type ButtonTone = "accent" | "white" | "glass" | "outline" | "navyGhost";

const BUTTON_BASE =
  "group inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150";

const BUTTON_TONES: Record<ButtonTone, string> = {
  accent:
    "bg-(--lc-accent) text-white shadow-[0_1px_2px_rgb(15_28_63/0.2),0_6px_16px_-6px_rgb(91_71_235/0.7)] hover:bg-(--lc-accent-strong)",
  white:
    "bg-white text-(--lc-ink) shadow-[0_1px_2px_rgb(15_28_63/0.18),0_8px_20px_-8px_rgb(20_10_80/0.55)] hover:bg-[#f1efff]",
  glass:
    "bg-[rgb(20_12_76/0.36)] text-white ring-1 ring-white/45 backdrop-blur-md ring-inset hover:bg-[rgb(20_12_76/0.5)]",
  outline:
    "bg-white text-(--lc-ink) ring-1 ring-(--lc-line-strong) ring-inset hover:ring-(--lc-ink)/40",
  navyGhost: "bg-white/[0.06] text-white ring-1 ring-white/20 ring-inset hover:bg-white/[0.12]",
};

export function buttonClass(tone: ButtonTone, className?: string): string {
  return cn(BUTTON_BASE, BUTTON_TONES[tone], className);
}
