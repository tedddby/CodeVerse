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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-4 py-12">
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <section aria-labelledby="explore-not-found-title" className="glass relative w-full max-w-xl rounded-2xl p-6 shadow-2xl animate-slide-up sm:p-8">
        <div className="mb-5 inline-flex size-12 items-center justify-center rounded-xl border border-signal/35 bg-signal/10 text-signal">
          <SearchX aria-hidden="true" className="size-6" />
        </div>
        <p className="font-mono text-xs text-ink-subtle">404 · Not a repository</p>
        <h1 id="explore-not-found-title" className="mt-1 text-xl font-semibold text-ink sm:text-2xl">
          That doesn&apos;t look like a GitHub repository.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Explorer links look like <code className="font-mono text-ink">/explore/owner/repository</code>. Paste a GitHub URL
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
                  className="inline-flex items-center rounded-md border border-line-strong bg-panel-raised/60 px-2.5 py-1 font-mono text-xs text-ink-muted transition-colors hover:border-signal/40 hover:text-ink"
                >
                  {example.owner}/{example.repo}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 border-t border-line/80 pt-5">
          <ButtonLink href="/" variant="ghost" size="sm">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back home
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
