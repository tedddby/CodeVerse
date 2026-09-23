import { Star } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { PROJECT_LINKS } from "./constants";
import { FocusInputLink } from "./focus-input-link";

/** Closing call to action: star the project or start exploring. */
export function GitHubCta() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:pb-32">
      <div className="border-line-strong bg-panel relative isolate overflow-hidden rounded-3xl border px-6 py-14 text-center sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="bg-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_100%,black,transparent)] opacity-60"
        />
        <div
          aria-hidden="true"
          className="via-signal/70 absolute inset-x-0 bottom-0 -z-10 h-px bg-linear-to-r from-transparent to-transparent"
        />
        <LogoMark className="mx-auto size-14" knockout="#0b111c" />
        <h2
          id="cta-title"
          className="text-ink mx-auto mt-6 max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
        >
          {siteConfig.tagline}
        </h2>
        <p className="text-ink-muted mx-auto mt-4 max-w-xl text-base leading-relaxed text-pretty">
          If CodeVerse helped you understand a codebase, a star helps other developers find it.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href={PROJECT_LINKS.repository} external variant="secondary" size="lg">
            <Star aria-hidden="true" className="text-warn size-4" />
            Star on GitHub
          </ButtonLink>
          <FocusInputLink className={buttonClasses("primary", "lg")}>
            Explore a repository
          </FocusInputLink>
        </div>
      </div>
    </section>
  );
}
