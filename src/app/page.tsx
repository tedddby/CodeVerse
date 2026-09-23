import type { Metadata } from "next";
import { SECTION_IDS } from "@/components/landing/constants";
import { DemoSection } from "@/components/landing/demo/demo-section";
import { Examples } from "@/components/landing/examples";
import { Features } from "@/components/landing/features";
import { GitHubCta } from "@/components/landing/github-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { OpenSource } from "@/components/landing/open-source";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SkipLink } from "@/components/landing/skip-link";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Landing page. A static server component: the only client islands are the
 * repository form, the input-focusing CTAs and the lazily started 3D demo.
 */
export default function HomePage() {
  return (
    <>
      <SkipLink targetId={SECTION_IDS.main} />
      <SiteHeader />
      <main id={SECTION_IDS.main} tabIndex={-1} className="overflow-x-clip focus:outline-none">
        <Hero />
        <DemoSection />
        <HowItWorks />
        <Features />
        <Examples />
        <OpenSource />
        <GitHubCta />
      </main>
      <SiteFooter />
    </>
  );
}
