import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getLanguage } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";
import { explorePath } from "@/lib/validation/repository-url";
import { exampleThumbnail } from "./example-thumbnails";
import { HoverArrow } from "./hover-arrow";
import { IsoArt } from "./iso-art";
import styles from "./landing.module.css";
import { SectionHeading } from "./section-heading";
import { ANCHORS, CONTAINER, SECTION_SPACING } from "./tokens";

interface ExampleNotes {
  /** Registry id of the dominant language. */
  language: string;
  lookFor: string;
  tag: string;
}

/** Editorial notes keyed by "owner/repo"; examples without notes fall back to their blurb. */
const EXAMPLE_NOTES: Readonly<Record<string, ExampleNotes>> = {
  "facebook/react": {
    language: "javascript",
    lookFor:
      "Every package under packages/ becomes its own district. Compare the renderers with the reconciler they share.",
    tag: "Monorepo",
  },
  "vercel/next.js": {
    language: "typescript",
    lookFor:
      "packages/next towers over the skyline, with a sprawling test/ district beside it. Switch to Activity to see where work happens now.",
    tag: "Monorepo",
  },
  "nodejs/node": {
    language: "javascript",
    lookFor:
      "lib/ is parsed JavaScript with symbols and imports; the C++ runtime in src/ and vendored deps/ are sized, not parsed.",
    tag: "Polyglot",
  },
  "torvalds/linux": {
    language: "c",
    lookFor:
      "Tens of thousands of files trigger directory-first mode, so drivers/, arch/ and fs/ read as districts at a glance.",
    tag: "Directory-first",
  },
};

/** Slabs for the directory-first sketch carry the language tint instead of paper gray. */
const DIRECTORY_FIRST_GROUND = { top: "#e7ecf4", left: "#c9d3e2", right: "#b5c1d4", edge: "#a9b6cb" };

/** Section 4: famous repositories as landmarks, each card one big link. */
export function Examples() {
  return (
    <section
      id={ANCHORS.examples}
      aria-labelledby="examples-title"
      className={cn("scroll-mt-4 bg-white", SECTION_SPACING)}
    >
      <div className={CONTAINER}>
        <SectionHeading
          id="examples-title"
          eyebrow="Examples"
          title="Start with a codebase you know."
        >
          <p>Famous repositories make good landmarks. Here is what to look for in each.</p>
        </SectionHeading>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {siteConfig.exampleRepositories.map(({ owner, repo, blurb }) => {
            const fullName = `${owner}/${repo}`;
            const notes = EXAMPLE_NOTES[fullName];
            const thumbnail = exampleThumbnail(fullName);
            const language = notes ? getLanguage(notes.language) : null;
            return (
              <li
                key={fullName}
                className="group relative flex flex-col rounded-2xl bg-white shadow-[0_1px_2px_rgb(15_28_63/0.05)] ring-1 ring-(--lc-line) transition-shadow duration-200 outline-offset-4 outline-(--lc-focus) hover:shadow-[0_1px_2px_rgb(15_28_63/0.05),0_18px_40px_-18px_rgb(15_28_63/0.3)] has-[a:focus-visible]:outline-2"
              >
                <div
                  aria-hidden="true"
                  className="flex h-[156px] items-center justify-center rounded-t-2xl border-b border-(--lc-line) bg-[linear-gradient(180deg,#f4f6fb,#fafbfd)] px-6 py-5"
                >
                  {thumbnail ? (
                    <IsoArt
                      geometry={thumbnail}
                      ground={notes?.tag === "Directory-first" ? DIRECTORY_FIRST_GROUND : undefined}
                      className="h-full w-full transition-transform duration-300 group-hover:-translate-y-1"
                    />
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3 text-[13px] text-(--lc-muted)">
                    <span className="flex items-center gap-2">
                      {language ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="size-2 rounded-full ring-1 ring-[rgb(15_28_63/0.12)]"
                            style={{ backgroundColor: language.color }}
                          />
                          {language.name}
                        </>
                      ) : (
                        "Repository"
                      )}
                    </span>
                    {notes ? (
                      <span className="rounded-full bg-(--lc-mist) px-2 py-0.5 text-[12px] font-medium text-(--lc-body) ring-1 ring-(--lc-line) ring-inset">
                        {notes.tag}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3.5 font-mono text-[15px] text-(--lc-ink)">
                    <Link
                      href={explorePath(owner, repo)}
                      aria-label={`Explore ${fullName}`}
                      className={cn(styles.noRing, "after:absolute after:inset-0 after:rounded-2xl")}
                    >
                      <span className="text-(--lc-muted)">{owner}/</span>
                      <span className="font-semibold">{repo}</span>
                    </Link>
                  </h3>
                  <p className="mt-1 text-[14px] text-(--lc-body)">{blurb}</p>
                  {notes ? (
                    <p className="mt-4 flex-1 border-t border-(--lc-line) pt-4 text-[14px] leading-[1.6] text-(--lc-body)">
                      {notes.lookFor}
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <p
                    aria-hidden="true"
                    className="mt-5 flex items-center gap-1.5 text-[14px] font-semibold text-(--lc-accent)"
                  >
                    Explore
                    <HoverArrow />
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
