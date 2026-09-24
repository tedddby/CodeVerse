import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Landing page. A static server component: the only client islands are the
 * repository card, the input-focusing CTAs and the lazily started 3D demo.
 */
export default function HomePage() {
  return <LandingPage />;
}
