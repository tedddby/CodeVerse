import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { RepositoryJumpForm } from "@/components/explorer/repository-jump-form";
import { ButtonLink } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { explorePath } from "@/lib/validation/repository-url";

/** Shown when the URL does not name a valid GitHub owner/repository. */
export default function ExploreNotFound() {
  return (
    <main className="bg-void relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] opacity-40"
      />
      <section
        aria-labelledby="explore-not-found-title"
        className="glass animate-slide-up relative w-full max-w-xl rounded-2xl p-6 shadow-2xl sm:p-8"
      >
        <div className="border-signal/35 bg-signal/10 text-signal mb-5 inline-flex size-12 items-center justify-center rounded-xl border">
          <SearchX aria-hidden="true" className="size-6" />
        </div>
        <p className="text-ink-subtle font-mono text-xs">404 · Not a repository</p>
        <h1
          id="explore-not-found-title"
          className="text-ink mt-1 text-xl font-semibold sm:text-2xl"
        >
          That doesn&apos;t look like a GitHub repository.
        </h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed">
          Explorer links look like{" "}
          <code className="text-ink font-mono">/explore/owner/repository</code>. Paste a GitHub URL
          below and we&apos;ll take you there.
        </p>

        <div className="mt-6">
          <RepositoryJumpForm label="Explore a repository" autoFocus />
        </div>

        <div className="mt-5">
          <SectionLabel>Popular examples</SectionLabel>
          <ul className="mt-2 flex flex-wrap gap-2">
            {siteConfig.exampleRepositories.map((example) => (
              <li key={`${example.owner}/${example.repo}`}>
                <Link
                  href={explorePath(example.owner, example.repo)}
                  className="border-line-strong bg-panel-raised/60 text-ink-muted hover:border-signal/40 hover:text-ink inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-xs transition-colors"
                >
                  {example.owner}/{example.repo}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-line/80 mt-8 border-t pt-5">
          <ButtonLink href="/" variant="ghost" size="sm">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back home
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
