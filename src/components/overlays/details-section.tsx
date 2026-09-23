import type { ReactNode } from "react";
import { SectionLabel } from "@/components/ui/primitives";

/** Labelled sub-section of the summary's details pane (a named region). */
export function DetailsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-4">
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      {children}
    </section>
  );
}
