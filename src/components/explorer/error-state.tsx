"use client";

import { ArrowLeft, CircleAlert, Clock, KeyRound, RefreshCw, SearchX, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ERROR_COPY, type AnalysisErrorCode, type AnalysisErrorPayload } from "@/analysis/protocol";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { formatRelativeTime } from "@/lib/utils/format";
import { explorePath } from "@/lib/validation/repository-url";
import { RepositoryJumpForm } from "./repository-jump-form";

export interface ErrorStateProps {
  error: AnalysisErrorPayload;
  owner: string;
  repo: string;
  onRetry: () => void;
  className?: string;
}

type ErrorTone = "missing" | "limit" | "network" | "failure";

const TONE_BY_CODE: Record<AnalysisErrorCode, ErrorTone> = {
  INVALID_REPOSITORY: "missing",
  NOT_FOUND: "missing",
  PRIVATE_OR_INACCESSIBLE: "missing",
  EMPTY_REPOSITORY: "missing",
  REF_NOT_FOUND: "missing",
  RATE_LIMITED: "limit",
  CLIENT_RATE_LIMITED: "limit",
  UNAUTHORIZED: "failure",
  UPSTREAM_ERROR: "network",
  TIMEOUT: "network",
  NETWORK_ERROR: "network",
  INTERNAL: "failure",
};

const TONE_ICON: Record<ErrorTone, ReactNode> = {
  missing: <SearchX aria-hidden="true" className="size-6" />,
  limit: <Clock aria-hidden="true" className="size-6" />,
  network: <WifiOff aria-hidden="true" className="size-6" />,
  failure: <CircleAlert aria-hidden="true" className="size-6" />,
};

const timeFormatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

/** "Resets at 3:42 PM (in 12 minutes)", or null when the date is missing/invalid. */
export function describeRetryAt(retryAt: string | undefined, now: number = Date.now()): string | null {
  if (!retryAt) return null;
  const time = Date.parse(retryAt);
  if (Number.isNaN(time)) return null;
  if (time <= now) return "The limit should have reset — try again now.";
  return `Resets at ${timeFormatter.format(time)} (${formatRelativeTime(retryAt, now)}).`;
}

/**
 * Full-screen, recoverable error screen for a failed analysis. Copy comes from
 * the server payload (which may carry specifics) with ERROR_COPY as fallback.
 */
export function ErrorState({ error, owner, repo, onRetry, className }: ErrorStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tone = TONE_BY_CODE[error.code] ?? "failure";
  const copy = ERROR_COPY[error.code] ?? ERROR_COPY.INTERNAL;
  const title = error.title || copy.title;
  const message = error.message || copy.message;
  const isRateLimit = error.code === "RATE_LIMITED" || error.code === "CLIENT_RATE_LIMITED";
  const retryHint = isRateLimit ? describeRetryAt(error.retryAt) : null;
  const examples = siteConfig.exampleRepositories.filter(
    (example) => example.owner.toLowerCase() !== owner.toLowerCase() || example.repo.toLowerCase() !== repo.toLowerCase(),
  );

  useEffect(() => {
    // Move focus to the explanation so keyboard and screen-reader users land on it.
    headingRef.current?.focus({ preventScroll: true });
  }, [error]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-void/85 px-4 py-10 backdrop-blur-sm animate-fade-in",
        className,
      )}
    >
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <section
        aria-labelledby="explorer-error-title"
        className="glass relative w-full max-w-xl rounded-2xl p-6 shadow-2xl animate-slide-up sm:p-8"
      >
        <div
          className={cn(
            "mb-5 inline-flex size-12 items-center justify-center rounded-xl border",
            tone === "limit" ? "border-warn/40 bg-warn/10 text-warn" : tone === "missing" ? "border-signal/35 bg-signal/10 text-signal" : "border-danger/40 bg-danger/10 text-danger",
          )}
        >
          {TONE_ICON[tone]}
        </div>
        <p className="font-mono text-xs text-ink-subtle">
          {owner}/{repo}
        </p>
        <div role="alert">
          <h1 id="explorer-error-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold text-ink focus:outline-none sm:text-2xl">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{message}</p>
        </div>

        {retryHint ? <p className="mt-3 font-mono text-xs text-warn">{retryHint}</p> : null}

        {error.code === "RATE_LIMITED" ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-line-strong bg-abyss/70 p-3 text-xs leading-relaxed text-ink-muted">
            <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal" />
            <p>
              Without a token, GitHub allows only 60 API requests per hour. Self-hosting CodeVerse? Set{" "}
              <code className="font-mono text-ink">GITHUB_TOKEN</code> on the server to raise the limit to 5,000
              requests per hour.
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back home
          </ButtonLink>
        </div>

        <div className="mt-8 border-t border-line/80 pt-6">
          <RepositoryJumpForm />
          {examples.length > 0 ? (
            <div className="mt-5">
              <SectionLabel>Or explore an example</SectionLabel>
              <ul className="mt-2 flex flex-wrap gap-2">
                {examples.map((example) => (
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
          ) : null}
        </div>
      </section>
    </div>
  );
}
