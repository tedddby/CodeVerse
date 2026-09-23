import type { Metadata } from "next";
import Link from "next/link";
import { SECTION_IDS } from "@/components/landing/constants";
import { ExampleChips } from "@/components/landing/example-chips";
import { HeroBackdrop } from "@/components/landing/hero-backdrop";
import { NotFoundSuggestion } from "@/components/landing/not-found-suggestion";
import { RepositoryForm } from "@/components/landing/repository-form";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SkipLink } from "@/components/landing/skip-link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <>
      <SkipLink targetId={SECTION_IDS.main} />
      <SiteHeader showSectionLinks={false} />
      <main
        id={SECTION_IDS.main}
        tabIndex={-1}
        className="relative isolate overflow-x-clip focus:outline-none"
      >
        <HeroBackdrop />
        <div className="mx-auto max-w-2xl px-4 pt-16 pb-64 sm:px-6 sm:pt-24 lg:pb-80">
          <p className="text-signal font-mono text-[11px] tracking-[0.22em] uppercase">
            404 · Not found
          </p>
          <h1 className="text-ink mt-4 text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
            Nothing at these coordinates.
          </h1>
          <p className="text-ink-muted mt-5 text-lg leading-relaxed text-pretty">
            This page doesn&apos;t exist, or the link is out of date. Paste a GitHub repository to
            explore instead.
          </p>
          <NotFoundSuggestion />
          <div className="glass mt-10 rounded-2xl p-5 sm:p-6">
            <RepositoryForm inputId="not-found-repository-input" />
            <ExampleChips className="border-line mt-5 border-t pt-5" />
          </div>
          <p className="mt-8 text-sm">
            <Link
              href="/"
              className="text-ink-muted hover:text-ink underline-offset-4 hover:underline"
            >
              ← Back to the home page
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
