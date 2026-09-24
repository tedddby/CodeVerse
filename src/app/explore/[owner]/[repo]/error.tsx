"use client";

import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

interface ExploreErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

/** Error boundary for unexpected render errors in the explorer segment. */
export default function ExploreError({ error, retry }: ExploreErrorProps) {
  useEffect(() => {
    console.error("[codeverse] explorer crashed", error);
  }, [error]);

  return (
    <main className="bg-void relative flex min-h-dvh items-center justify-center px-4 py-12">
      <section
        role="alert"
        className="glass animate-slide-up w-full max-w-lg rounded-2xl p-6 shadow-2xl sm:p-8"
      >
        <div className="border-danger/40 bg-danger/10 text-danger mb-5 inline-flex size-12 items-center justify-center rounded-xl border">
          <TriangleAlert aria-hidden="true" className="size-6" />
        </div>
        <h1 className="text-ink text-xl font-semibold">The explorer ran into a problem.</h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed">
          Something unexpected broke while rendering this repository. Trying again usually helps; if
          it keeps happening, please open an issue so we can fix it.
        </p>
        {error.digest ? (
          <p className="text-ink-subtle mt-3 font-mono text-xs">
            Reference: <span className="text-ink-muted select-all">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => retry()}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back home
          </ButtonLink>
          <ButtonLink href={`${siteConfig.repositoryUrl}/issues`} variant="ghost" external>
            Report an issue
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
