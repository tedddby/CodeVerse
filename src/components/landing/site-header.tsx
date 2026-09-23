import Link from "next/link";
import { GitHubMark } from "@/components/brand/github-mark";
import { Logo } from "@/components/brand/logo";
import { siteConfig } from "@/config/site";
import { PROJECT_LINKS, SECTION_IDS } from "./constants";

const NAV_ITEMS = [
  { href: `#${SECTION_IDS.demo}`, label: "Demo" },
  { href: `#${SECTION_IDS.howItWorks}`, label: "How it works" },
  { href: `#${SECTION_IDS.features}`, label: "Features" },
  { href: `#${SECTION_IDS.examples}`, label: "Examples" },
] as const;

/** Sticky top bar for the landing and 404 pages. */
export function SiteHeader({ showSectionLinks = true }: { showSectionLinks?: boolean }) {
  return (
    <header className="border-line/70 bg-void/75 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={`${siteConfig.name} home`} className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {showSectionLinks ? (
            <ul className="hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-ink-muted hover:text-ink rounded-md px-3 py-1.5 text-sm transition-colors"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <a
            href={PROJECT_LINKS.repository}
            target="_blank"
            rel="noopener noreferrer"
            className="border-line-strong text-ink-muted hover:border-signal/50 hover:text-ink ml-1 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
          >
            <GitHubMark className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
            <span className="sr-only sm:hidden">{siteConfig.name} on GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
