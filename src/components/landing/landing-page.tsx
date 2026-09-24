import { CtaBand } from "./cta-band";
import { DemoShowcase } from "./demo-showcase";
import { Examples } from "./examples";
import { Features } from "./features";
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";
import styles from "./landing.module.css";
import { OpenSource } from "./open-source";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SkipLink } from "./skip-link";
import { StatsStrip } from "./stats-strip";
import { ANCHORS } from "./tokens";

/**
 * The CodeVerse landing page. A static server component;
 * the client islands are the repository card, the input-focusing links and the
 * lazily started 3D demo.
 */
export function LandingPage() {
  return (
    <div className={styles.root}>
      <SkipLink targetId={ANCHORS.main} />
      <SiteHeader />
      <main id={ANCHORS.main} tabIndex={-1} className={styles.noRing}>
        <Hero />
        <StatsStrip />
        <DemoShowcase />
        <HowItWorks />
        <Features />
        <Examples />
        <OpenSource />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
