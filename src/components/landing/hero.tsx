import { GitHubMark } from "@/components/brand/github-mark";
import { FocusInputLink } from "@/components/landing/focus-input-link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { ExampleChips } from "./example-chips";
import { GradientField } from "./gradient-field";
import { HeroCity } from "./hero-city";
import { HoverArrow } from "./hover-arrow";
import styles from "./landing.module.css";
import { RepositoryCard } from "./repository-card";
import { buttonClass, CONTAINER } from "./tokens";

/**
 * Above the fold: the gradient field with the promise in white, and the
 * repository card straddling the skewed edge between the gradient and the page.
 * The demo repository's city rises behind the card and crosses the edge,
 * white on color and ink on paper.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate">
      {/* Short desktop screens (1280x720 laptops) tighten the band so the repository card stays above the fold. */}
      <div className="relative z-[1] pt-[132px] pb-[176px] sm:pt-[156px] sm:pb-[196px] lg:pt-[168px] lg:pb-[212px] lg:[@media(max-height:820px)]:pt-[108px] lg:[@media(max-height:820px)]:pb-[188px]">
        <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden", styles.skewBottom)}>
          <GradientField />
          <div className={styles.horizon}>
            <div className={cn(styles.heroCity, styles.heroCityOnColor)}>
              <HeroCity surface="color" withGeometry maskId="lc-city-mask-hero" className="w-full" />
            </div>
          </div>
        </div>

        <div className={cn(CONTAINER, styles.onColor, "relative text-center")}>
          <h1
            id="hero-title"
            className="mx-auto max-w-[15ch] text-[clamp(2.6rem,1.05rem+5.6vw,5.1rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-white sm:max-w-none"
          >
            {siteConfig.headline}
          </h1>
          <p className="mx-auto mt-6 max-w-[34rem] text-[clamp(1.08rem,0.98rem+0.45vw,1.3rem)] leading-[1.55] text-pretty text-white">
            {siteConfig.description}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <FocusInputLink className={buttonClass("white")}>
              Explore a repository
              <HoverArrow />
            </FocusInputLink>
            <a
              href={siteConfig.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              className={buttonClass("glass")}
            >
              <GitHubMark aria-hidden="true" className="size-4" />
              <span aria-hidden="true">
                <span className="max-sm:hidden">View on </span>GitHub
              </span>
            </a>
          </div>
        </div>
      </div>

      <div className="relative pb-6">
        <div aria-hidden="true" className={cn(styles.heroCity, styles.heroCityOnPage)}>
          <HeroCity surface="page" className="w-full" />
        </div>
        <div className={cn(CONTAINER, "relative z-[2] -mt-[112px] sm:-mt-[124px] lg:-mt-[136px]")}>
          <RepositoryCard className="mx-auto max-w-[720px] text-left max-sm:-mx-1" />
          <ExampleChips className="mt-7" />
        </div>
      </div>
    </section>
  );
}
