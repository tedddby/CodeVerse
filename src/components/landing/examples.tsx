import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { getLanguage } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";
import { explorePath } from "@/lib/validation/repository-url";
import { SECTION_IDS } from "./constants";
import { SectionHeading } from "./section-heading";

interface ExampleNotes {
  /** Registry language id of the dominant language. */
  language: string;
  lookFor: string;
  tags: readonly string[];
}

/**
 * Editorial notes for the configured examples, keyed by "owner/repo". Examples
 * without notes (after editing site.ts) fall back to their configured blurb.
 */
const EXAMPLE_NOTES: Readonly<Record<string, ExampleNotes>> = {
  "facebook/react": {
    language: "javascript",
    lookFor:
      "Every package under packages/ becomes its own district. Compare the renderer districts with the reconciler they share.",
    tags: ["Monorepo"],
  },
  "vercel/next.js": {
    language: "typescript",
    lookFor:
      "packages/next towers over the skyline with a sprawling test/ district beside it. Switch to Activity to see where work happens now.",
    tags: ["Monorepo"],
  },
  "nodejs/node": {
    language: "javascript",
    lookFor:
      "lib/ is parsed JavaScript with symbols and imports; the C++ runtime in src/ and vendored deps/ are sized but not parsed.",
    tags: ["Polyglot"],
  },
  "torvalds/linux": {
    language: "c",
    lookFor:
      "Tens of thousands of files trigger directory-first mode, so drivers/, arch/ and fs/ read as districts at a glance.",
    tags: ["Directory-first"],
  },
};

/** Section 04: curated example repositories. */
export function Examples() {
  return (
    <section
      id={SECTION_IDS.examples}
      aria-labelledby="examples-title"
      className="border-line bg-abyss/60 scroll-mt-16 border-y"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading
          id="examples-title"
          index="04"
          eyebrow="Examples"
          title="Start with a codebase you know."
        >
          <p>Famous repositories make good landmarks. Here is what to look for in each.</p>
        </SectionHeading>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {siteConfig.exampleRepositories.map(({ owner, repo, blurb }) => {
            const fullName = `${owner}/${repo}`;
            const notes = EXAMPLE_NOTES[fullName];
            return (
              <li
                key={fullName}
                className="group border-line bg-panel/60 hover:border-line-strong has-[a:focus-visible]:border-signal/70 has-[a:focus-visible]:ring-signal/40 relative flex flex-col rounded-2xl border p-5 transition-colors has-[a:focus-visible]:ring-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-ink-muted flex items-center gap-2 text-xs">
                    {notes ? (
                      <>
                        <LanguageDot language={notes.language} />
                        {getLanguage(notes.language).name}
                      </>
                    ) : (
                      "Repository"
                    )}
                  </p>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="text-ink-muted group-hover:text-signal size-4 transition-colors"
                  />
                </div>
                <h3 className="text-ink mt-4 font-mono text-[15px]">
                  <Link
                    href={explorePath(owner, repo)}
                    aria-label={`Explore ${fullName}`}
                    className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
                  >
                    <span className="text-ink-muted">{owner}/</span>
                    {repo}
                  </Link>
                </h3>
                <p className={cn("text-ink-muted mt-1 text-sm", !notes && "flex-1")}>{blurb}</p>
                {notes ? (
                  <>
                    <p className="border-line text-ink-muted mt-4 flex-1 border-t pt-4 text-sm leading-relaxed">
                      {notes.lookFor}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {notes.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
