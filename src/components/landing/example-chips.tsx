import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { explorePath } from "@/lib/validation/repository-url";

/** One-click example repositories, under the hero card. */
export function ExampleChips({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5", className)}>
      <span aria-hidden="true" className="text-[14px] font-medium text-(--lc-muted)">
        Or try
      </span>
      {/* A named list (not an id reference) so the chips can appear on several pages. */}
      <ul aria-label="Example repositories" className="flex flex-wrap justify-center gap-2">
        {siteConfig.exampleRepositories.map(({ owner, repo }) => (
          <li key={`${owner}/${repo}`}>
            <Link
              href={explorePath(owner, repo)}
              className="inline-flex h-9 items-center rounded-full bg-white px-3.5 font-mono text-[13px] text-(--lc-muted) ring-1 ring-(--lc-line-strong) transition-[color,box-shadow] duration-150 ring-inset hover:text-(--lc-ink) hover:ring-(--lc-accent)"
            >
              {owner}/<span className="font-medium text-(--lc-ink)">{repo}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
