import { GitHubMark } from "@/components/brand/github-mark";
import { FocusInputLink } from "@/components/landing/focus-input-link";
import { PROJECT_LINKS } from "@/components/landing/constants";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { GradientField } from "./gradient-field";
import { HeroCity } from "./hero-city";
import { HoverArrow } from "./hover-arrow";
import styles from "./landing.module.css";
import { buttonClass, CONTAINER } from "./tokens";

/** Closing band: the hero gradient again, skewed on both edges. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="relative isolate -mt-[var(--lc-skew)]">
      <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden", styles.skewBoth)}>
        <GradientField />
        {/* The hero's city again, a bookend rising from the band's lower edge. */}
        <div
          className={cn(
            styles.cityOnColor,
            "absolute bottom-0 left-1/2 w-[max(820px,112vw)] -translate-x-1/2 translate-y-[66%] opacity-75 lg:w-[max(1200px,88vw)]",
          )}
        >
          <HeroCity surface="color" maskId="lc-city-mask-cta" className="w-full" />
        </div>
      </div>
      <div
        className={cn(
          CONTAINER,
          styles.onColor,
          "relative py-[calc(var(--lc-skew)+5rem)] text-center sm:py-[calc(var(--lc-skew)+6rem)]",
        )}
      >
        <h2
          id="cta-title"
          className="mx-auto max-w-[18ch] text-[clamp(2.1rem,1.3rem+2.8vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.04em] text-balance text-white"
        >
          {siteConfig.tagline}
        </h2>
        <p className="mx-auto mt-5 max-w-[34rem] text-[18px] leading-[1.6] text-white">
          Paste a repository and see its shape in seconds. If CodeVerse helps you, a star helps
          other developers find it.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <FocusInputLink className={buttonClass("white")}>
            Explore a repository
            <HoverArrow />
          </FocusInputLink>
          <a
            href={PROJECT_LINKS.repository}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("glass")}
          >
            <GitHubMark className="size-4" />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
