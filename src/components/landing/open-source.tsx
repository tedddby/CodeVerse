import { Container, Scale, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { getLanguage, LANGUAGES } from "@/lib/languages/registry";
import { PROJECT_LINKS, SECTION_IDS } from "./constants";
import { SectionHeading } from "./section-heading";

const PARSED_LANGUAGES = ["typescript", "javascript", "python", "java", "go", "rust"] as const;

interface Principle {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
}

const PRINCIPLES: readonly Principle[] = [
  {
    icon: Scale,
    title: "MIT licensed",
    body: "The analyzer, parser, layout engine and renderer are all in the repository. Use it, fork it, ship it.",
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    body: "No accounts, analytics or tracking. Source files are never stored; cached graphs hold structure and metadata only.",
  },
  {
    icon: Container,
    title: "Self-hostable",
    body: (
      <>
        Deploy to Vercel or run the Docker image. An optional{" "}
        <code className="text-ink font-mono text-[0.85em]">GITHUB_TOKEN</code> raises API limits and
        unlocks full history, and never reaches the browser.
      </>
    ),
  },
];

/** Section 05: licence, privacy, self-hosting and supported languages. */
export function OpenSource() {
  return (
    <section
      id={SECTION_IDS.openSource}
      aria-labelledby="open-source-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 lg:py-28"
    >
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <SectionHeading
            id="open-source-title"
            index="05"
            eyebrow="Open source"
            title="Open source, private by default."
          >
            <p>
              CodeVerse analyzes public repositories on demand and keeps nothing it does not need.
              Read how it works, run it yourself, or help teach it a new language.
            </p>
          </SectionHeading>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={PROJECT_LINKS.architecture} external variant="secondary">
              Read the architecture
            </ButtonLink>
            <ButtonLink href={PROJECT_LINKS.contributing} external variant="ghost">
              Contribute
            </ButtonLink>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border-line bg-panel/50 rounded-2xl border p-5">
              <Icon aria-hidden="true" className="text-signal size-5" />
              <h3 className="text-ink mt-4 text-base font-semibold tracking-[-0.01em]">{title}</h3>
              <p className="text-ink-muted mt-2 text-sm leading-relaxed">{body}</p>
            </div>
          ))}
          <div className="border-line bg-panel/50 rounded-2xl border p-5">
            <p className="text-signal font-mono text-[11px] tracking-[0.18em] uppercase">
              AST-parsed languages
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {PARSED_LANGUAGES.map((id) => {
                const language = getLanguage(id);
                return (
                  <li key={id} className="text-ink flex items-center gap-2 text-sm">
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
            <p className="text-ink-muted mt-4 text-xs leading-relaxed">
              {LANGUAGES.length - PARSED_LANGUAGES.length} more languages are recognized, sized and
              colored in the world without being parsed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
