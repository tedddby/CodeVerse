import { ArrowDown } from "lucide-react";
import { GitHubMark } from "@/components/brand/github-mark";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { PROJECT_LINKS, SECTION_IDS } from "./constants";
import { ExampleChips } from "./example-chips";
import { FocusInputLink } from "./focus-input-link";
import { HeroBackdrop } from "./hero-backdrop";
import { RepositoryForm } from "./repository-form";

const TRUST_POINTS = ["MIT licensed", "Repository code is never executed", "No tracking"] as const;

/**
 * Above the fold. DOM order is copy → form → calls to action, so on phones the
 * form sits right under the promise; on desktop the form moves to the right
 * column and the calls to action sit under the copy.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex flex-col justify-center lg:min-h-[min(calc(100svh-3.5rem),58rem)]"
    >
      <HeroBackdrop />
      <div className="mx-auto grid w-full max-w-6xl gap-x-14 gap-y-10 px-4 pt-14 pb-44 sm:px-6 sm:pt-20 lg:grid-cols-2 lg:gap-y-9 lg:pt-16 lg:pb-48">
        <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="border-line-strong bg-panel/60 text-ink-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase">
            <span aria-hidden="true" className="bg-ok size-1.5 rounded-full" />
            Open source code explorer
          </p>
          <h1
            id="hero-title"
            className="text-ink mt-6 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.1rem]"
          >
            {siteConfig.headline}
          </h1>
          <p className="text-ink-muted mt-6 max-w-xl text-lg leading-relaxed text-pretty">
            {siteConfig.description}
          </p>
        </div>

        <div className="glass animate-slide-up rounded-2xl p-5 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)] sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <div className="border-line mb-5 flex items-center justify-between gap-3 border-b pb-4">
            <p className="text-ink font-mono text-[11px] tracking-[0.18em] uppercase">
              New exploration
            </p>
            <p className="text-ink-muted font-mono text-[11px]">github.com</p>
          </div>
          <RepositoryForm />
          <ExampleChips className="border-line mt-5 border-t pt-5" />
        </div>

        <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <div className="flex flex-wrap gap-3">
            <FocusInputLink className={buttonClasses("primary", "lg")}>
              Explore a repository
            </FocusInputLink>
            <ButtonLink href={PROJECT_LINKS.repository} external variant="secondary" size="lg">
              <GitHubMark className="size-4" />
              View on GitHub
            </ButtonLink>
          </div>
          <ul className="text-ink-muted mt-9 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span aria-hidden="true" className="bg-signal/70 h-px w-3" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <a
        href={`#${SECTION_IDS.demo}`}
        className="text-ink-muted hover:text-ink absolute bottom-8 left-1/2 hidden -translate-x-1/2 items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors lg:inline-flex"
      >
        <ArrowDown aria-hidden="true" className="size-3.5" />
        See it running
      </a>
    </section>
  );
}
