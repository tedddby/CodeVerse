import type { ComponentType } from "react";
import { cn } from "@/lib/utils/cn";
import {
  ActivityMockup,
  ArchitectureMockup,
  ComplexityMockup,
  ContributorsMockup,
  DependencyMockup,
  LargeRepositoryMockup,
  SearchMockup,
  ShareMockup,
} from "./feature-mockups";
import { SectionHeading } from "./section-heading";
import { ANCHORS, CONTAINER, SECTION_SPACING } from "./tokens";

interface Feature {
  title: string;
  body: string;
  /** Keyboard shortcut in the explorer, when there is one. */
  shortcut?: string;
  Mockup: ComponentType;
  wide?: boolean;
}

const FEATURES: readonly Feature[] = [
  {
    title: "Architecture districts",
    body: "Directories become terraced districts and files become buildings, sized by lines of code and colored by language.",
    shortcut: "1",
    Mockup: ArchitectureMockup,
    wide: true,
  },
  {
    title: "Dependency arcs",
    body: "Resolved imports arc between buildings. Select a file to trace what it depends on, and what depends on it.",
    shortcut: "2",
    Mockup: DependencyMockup,
    wide: true,
  },
  {
    title: "Activity & history timeline",
    body: "Scrub through recent commits and watch the files they touched light up.",
    shortcut: "3",
    Mockup: ActivityMockup,
  },
  {
    title: "Contributors",
    body: "Pick a contributor to see which parts of the codebase they shaped in the analyzed history.",
    shortcut: "4",
    Mockup: ContributorsMockup,
  },
  {
    title: "Complexity",
    body: "Large files with many symbols and dependencies stand out, so hotspots are visible from orbit.",
    shortcut: "5",
    Mockup: ComplexityMockup,
  },
  {
    title: "Search & source viewer",
    body: "Jump to any file or symbol, then read highlighted source at the exact line, fetched on demand.",
    shortcut: "/",
    Mockup: SearchMockup,
  },
  {
    title: "Shareable views",
    body: "Links carry the revision, mode, selection and camera, so whoever opens one lands exactly where you are.",
    Mockup: ShareMockup,
    wide: true,
  },
  {
    title: "Large-repository modes",
    body: "Progressive and directory-first tiers keep huge repositories responsive, and always say what was left out.",
    Mockup: LargeRepositoryMockup,
    wide: true,
  },
];

/** Section 3: eight lenses on the same graph, each with a product miniature. */
export function Features() {
  return (
    <section
      id={ANCHORS.features}
      aria-labelledby="features-title"
      className={cn("scroll-mt-4 bg-(--lc-mist)", SECTION_SPACING)}
    >
      <div className={CONTAINER}>
        <SectionHeading id="features-title" eyebrow="Features" title="Eight ways to read a codebase.">
          <p>
            Switch lenses without leaving the scene. Every view reads the same graph, and the modes
            sit on number keys.
          </p>
        </SectionHeading>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {FEATURES.map(({ title, body, shortcut, Mockup, wide }) => (
            <li
              key={title}
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(15_28_63/0.05),0_12px_32px_-18px_rgb(15_28_63/0.22)] ring-1 ring-(--lc-line)",
                wide && "sm:col-span-2",
              )}
            >
              <div
                aria-hidden="true"
                className="relative h-[208px] overflow-hidden border-b border-(--lc-line) bg-[linear-gradient(180deg,#f7f8fc,#ffffff)]"
              >
                <Mockup />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[17px] leading-snug font-semibold tracking-[-0.015em] text-(--lc-ink)">
                    {title}
                  </h3>
                  {shortcut ? (
                    <kbd className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-(--lc-mist) px-1.5 font-mono text-[12px] text-(--lc-body) shadow-[inset_0_-1px_0_rgb(15_28_63/0.12)] ring-1 ring-(--lc-line-strong) ring-inset">
                      <span className="sr-only">Shortcut </span>
                      {shortcut}
                    </kbd>
                  ) : null}
                </div>
                <p className="mt-2 text-[15px] leading-[1.6] text-(--lc-body)">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
