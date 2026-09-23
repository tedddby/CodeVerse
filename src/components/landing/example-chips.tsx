import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { explorePath } from "@/lib/validation/repository-url";

/** One-click example repositories from the site configuration. */
export function ExampleChips({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <span
        aria-hidden="true"
        className="text-ink-muted font-mono text-[11px] tracking-[0.18em] uppercase"
      >
        Try
      </span>
      <ul aria-label="Example repositories" className="flex flex-wrap gap-2">
        {siteConfig.exampleRepositories.map(({ owner, repo }) => (
          <li key={`${owner}/${repo}`}>
            <Link
              href={explorePath(owner, repo)}
              className="border-line-strong bg-panel/70 text-ink-muted hover:border-signal/50 hover:text-ink inline-flex h-8 items-center rounded-lg border px-2.5 font-mono text-xs transition-colors"
            >
              {owner}/<span className="text-ink">{repo}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
