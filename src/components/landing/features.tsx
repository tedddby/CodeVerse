import type { ComponentType } from "react";
import { SECTION_IDS } from "./constants";
import {
  ActivityIllustration,
  ContributorsIllustration,
  SearchIllustration,
  ShareIllustration,
} from "./illustrations/insight-illustrations";
import {
  ArchitectureIllustration,
  ComplexityIllustration,
  DependencyIllustration,
  LargeRepositoryIllustration,
} from "./illustrations/structure-illustrations";
import { SectionHeading } from "./section-heading";

interface Feature {
  title: string;
  body: string;
  /** Keyboard shortcut in the explorer, when there is one. */
  shortcut?: string;
  Illustration: ComponentType;
}

const FEATURES: readonly Feature[] = [
  {
    title: "Architecture districts",
    body: "Directories become districts and files become buildings, sized by lines of code and colored by language.",
    shortcut: "1",
    Illustration: ArchitectureIllustration,
  },
  {
    title: "Dependency arcs",
    body: "Resolved imports arc between buildings. Select a file to trace what it depends on and what depends on it.",
    shortcut: "2",
    Illustration: DependencyIllustration,
  },
  {
    title: "Activity & history timeline",
    body: "Scrub through recent commits and watch the files they touched light up, district by district.",
    shortcut: "3",
    Illustration: ActivityIllustration,
  },
  {
    title: "Contributors",
    body: "Pick a contributor to see which parts of the codebase they have shaped in the analyzed history.",
    shortcut: "4",
    Illustration: ContributorsIllustration,
  },
  {
    title: "Complexity",
    body: "Large files with many symbols and dependencies stand out, so likely hotspots are visible from orbit.",
    shortcut: "5",
    Illustration: ComplexityIllustration,
  },
  {
    title: "Search & source viewer",
    body: "Jump to any file or symbol, then read syntax-highlighted source at the exact line, fetched on demand.",
    shortcut: "/",
    Illustration: SearchIllustration,
  },
  {
    title: "Shareable views",
    body: "Copy a link that reopens the same revision, view mode, camera angle and selection for whoever you send it to.",
    Illustration: ShareIllustration,
  },
  {
    title: "Large-repository modes",
    body: "Progressive and directory-first tiers keep huge repositories responsive, and always say what was left out.",
    Illustration: LargeRepositoryIllustration,
  },
];

/** Section 03: feature showcase with crafted micro-illustrations. */
export function Features() {
  return (
    <section
      id={SECTION_IDS.features}
      aria-labelledby="features-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 lg:py-28"
    >
      <SectionHeading
        id="features-title"
        index="03"
        eyebrow="Features"
        title="Eight ways to read a codebase."
      >
        <p>
          Switch lenses without leaving the scene. Every view reads the same graph, and each mode
          has a keyboard shortcut.
        </p>
      </SectionHeading>

      <ul className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map(({ title, body, shortcut, Illustration }) => (
          <li
            key={title}
            className="border-line bg-panel/50 hover:border-line-strong flex flex-col overflow-hidden rounded-2xl border transition-colors"
          >
            <div className="border-line bg-abyss/80 border-b px-3 py-4">
              <Illustration />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-ink text-base font-semibold tracking-[-0.01em]">{title}</h3>
                {shortcut ? (
                  <kbd className="kbd shrink-0">
                    <span className="sr-only">Shortcut </span>
                    {shortcut}
                  </kbd>
                ) : null}
              </div>
              <p className="text-ink-muted mt-2 text-sm leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
