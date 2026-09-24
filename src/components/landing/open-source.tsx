import { PROJECT_LINKS } from "@/components/landing/constants";
import { getLanguage, LANGUAGES } from "@/lib/languages/registry";
import { cn } from "@/lib/utils/cn";
import { CodeWindow } from "./code-window";
import { HoverArrow } from "./hover-arrow";
import styles from "./landing.module.css";
import { SectionHeading } from "./section-heading";
import { ANCHORS, buttonClass, CONTAINER } from "./tokens";

const PARSED_LANGUAGES = ["typescript", "javascript", "python", "java", "go", "rust"] as const;

const PRINCIPLES = [
  {
    title: "MIT licensed",
    body: "Analyzer, parser, layout engine and renderer all live in the repository. Use it, fork it, ship it.",
  },
  {
    title: "No tracking",
    body: "No accounts, no analytics, no tracking. Paste a URL and explore.",
  },
  {
    title: "Source never stored",
    body: "Cached graphs hold structure and metadata only. Source is fetched when you open a file.",
  },
  {
    title: "Self-hostable",
    body: "Deploy to Vercel or run the Docker image. An optional GITHUB_TOKEN stays on the server.",
  },
] as const;

/** Section 5: the deep-navy developer section — licence, privacy, self-hosting, languages. */
export function OpenSource() {
  return (
    <section
      id={ANCHORS.openSource}
      aria-labelledby="open-source-title"
      className={cn(
        "relative isolate scroll-mt-4 overflow-hidden bg-(--lc-navy) py-24 sm:py-28 lg:py-32",
        styles.onColor,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_85%_0%,rgb(107_69_242/0.38),transparent_70%),radial-gradient(45%_50%_at_0%_100%,rgb(24_194_240/0.16),transparent_70%)]"
      />
      {/* Column guides aligned with the principles grid below. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 hidden [mask-image:linear-gradient(180deg,transparent,black_18%,black_55%,transparent_92%)] lg:block"
      >
        <div className={cn(CONTAINER, "grid h-full grid-cols-4")}>
          {[0, 1, 2, 3].map((column) => (
            <div key={column} className="border-l border-white/[0.07] last:border-r" />
          ))}
        </div>
      </div>
      <div className={CONTAINER}>
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <SectionHeading
              id="open-source-title"
              tone="navy"
              eyebrow="Open source"
              title="Open source, private by default."
            >
              <p>
                CodeVerse analyzes public repositories on demand and keeps nothing it does not need.
                Read how it works, run it yourself, or teach it a new language.
              </p>
            </SectionHeading>
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href={PROJECT_LINKS.architecture}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("white")}
              >
                Read the architecture
                <HoverArrow />
              </a>
              <a
                href={PROJECT_LINKS.contributing}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("navyGhost")}
              >
                Contribute
                <HoverArrow />
              </a>
            </div>
          </div>
          <CodeWindow />
        </div>

        <ul className="mt-16 grid gap-px overflow-hidden rounded-2xl bg-white/[0.1] ring-1 ring-white/[0.1] sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {PRINCIPLES.map((principle) => (
            <li key={principle.title} className="bg-(--lc-navy-raised) p-6">
              <h3 className="flex items-center gap-2.5 text-[16px] font-semibold text-white">
                <span aria-hidden="true" className="h-3.5 w-[3px] rounded-full bg-[#9fe8ff]" />
                {principle.title}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[#b7c1d6]">{principle.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <h3 className="text-[14px] font-semibold text-white">Parsed into syntax trees</h3>
            <ul className="flex flex-wrap gap-2">
              {PARSED_LANGUAGES.map((id) => {
                const language = getLanguage(id);
                return (
                  <li
                    key={id}
                    className="inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.06] px-3 text-[13px] text-[#dfe5f1] ring-1 ring-white/[0.12] ring-inset"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: language.color }}
                    />
                    {language.name}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-[14px] text-[#b7c1d6]">
            {LANGUAGES.length - PARSED_LANGUAGES.length} more languages are recognized, sized and
            colored.
          </p>
        </div>
      </div>
    </section>
  );
}
