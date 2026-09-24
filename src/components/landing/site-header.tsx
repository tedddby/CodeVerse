import Link from "next/link";
import { GitHubMark } from "@/components/brand/github-mark";
import { PROJECT_LINKS } from "@/components/landing/constants";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils/cn";
import { BrandLockup } from "./brand";
import styles from "./landing.module.css";
import { ANCHORS, CONTAINER } from "./tokens";

const NAV_ITEMS = [
  { href: `/#${ANCHORS.demo}`, label: "Demo" },
  { href: `/#${ANCHORS.howItWorks}`, label: "How it works" },
  { href: `/#${ANCHORS.features}`, label: "Features" },
  { href: `/#${ANCHORS.examples}`, label: "Examples" },
  { href: `/#${ANCHORS.openSource}`, label: "Open source" },
] as const;

/** Top bar laid over the hero gradient (white on color). */
export function SiteHeader() {
  return (
    <header className={cn("absolute inset-x-0 top-0 z-20", styles.onColor)}>
      <div className={cn(CONTAINER, "flex h-[72px] items-center justify-between gap-6")}>
        <Link href="/" aria-label={`${siteConfig.name} home`} className="rounded-md">
          <BrandLockup surface="color" maskId="lc-mark-header" />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-2">
          <ul className="hidden items-center lg:flex">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-[15px] font-medium text-white/90 transition-[color] hover:text-white"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <a
            href={PROJECT_LINKS.repository}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex size-9 items-center justify-center gap-2 rounded-full bg-[rgb(20_12_76/0.3)] text-[14px] font-semibold text-white ring-1 ring-white/40 transition-[background-color] ring-inset hover:bg-[rgb(20_12_76/0.46)] sm:w-auto sm:px-3.5"
          >
            <GitHubMark className="size-4" />
            <span className="sr-only sm:not-sr-only">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
