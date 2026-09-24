import type { Metadata } from "next";
import Link from "next/link";
import { ExampleChips } from "@/components/landing/example-chips";
import { GradientField } from "@/components/landing/gradient-field";
import styles from "@/components/landing/landing.module.css";
import { NotFoundSuggestion } from "@/components/landing/not-found-suggestion";
import { RepositoryCard } from "@/components/landing/repository-card";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SkipLink } from "@/components/landing/skip-link";
import { ANCHORS, CONTAINER } from "@/components/landing/tokens";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className={styles.root}>
      <SkipLink targetId={ANCHORS.main} />
      <SiteHeader />
      <main id={ANCHORS.main} tabIndex={-1} className={styles.noRing}>
        <section aria-labelledby="not-found-title" className="relative isolate">
          <div className="relative z-[1] pt-[132px] pb-[168px] sm:pt-[150px] sm:pb-[184px]">
            <div
              aria-hidden="true"
              className={cn("absolute inset-0 overflow-hidden", styles.skewBottom)}
            >
              <GradientField />
            </div>
            <div className={cn(CONTAINER, styles.onColor, "relative text-center")}>
              <p className="font-mono text-[12px] tracking-[0.22em] text-white/85 uppercase">
                404 · Not found
              </p>
              <h1
                id="not-found-title"
                className="mx-auto mt-4 max-w-[18ch] text-[clamp(2.2rem,1.2rem+3.4vw,3.6rem)] leading-[1.05] font-semibold tracking-[-0.04em] text-balance text-white"
              >
                Nothing at these coordinates.
              </h1>
              <p className="mx-auto mt-5 max-w-[32rem] text-[1.08rem] leading-[1.6] text-pretty text-white">
                This page doesn&apos;t exist, or the link is out of date. Paste a GitHub repository
                to explore instead.
              </p>
            </div>
          </div>
          <div className={cn(CONTAINER, "relative z-[2] -mt-[104px] pb-24 sm:-mt-[116px]")}>
            <RepositoryCard className="mx-auto max-w-[720px] text-left max-sm:-mx-1" />
            <NotFoundSuggestion />
            <ExampleChips className="mt-7" />
            <p className="mt-10 text-center text-[15px]">
              <Link
                href="/"
                className="font-medium text-(--lc-accent) underline-offset-4 hover:underline"
              >
                ← Back to the home page
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
