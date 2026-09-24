import { PROJECT_LINKS } from "@/components/landing/constants";
import { siteConfig } from "@/config/site";
import { BrandLockup } from "./brand";
import { CONTAINER } from "./tokens";

const FOOTER_LINKS = [
  { href: PROJECT_LINKS.repository, label: "GitHub" },
  { href: PROJECT_LINKS.architecture, label: "Architecture docs" },
  { href: PROJECT_LINKS.privacy, label: "Privacy" },
  { href: PROJECT_LINKS.security, label: "Security" },
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-white">
      <div className={`${CONTAINER} flex flex-col gap-8 py-12 md:flex-row md:items-center md:justify-between`}>
        <div>
          <BrandLockup surface="light" maskId="lc-mark-footer" />
          <p className="mt-3 text-[14px] text-(--lc-muted)">{siteConfig.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-7 gap-y-3 text-[14px] font-medium">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded text-(--lc-body) transition-[color] hover:text-(--lc-ink)"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-(--lc-line)">
        <p className={`${CONTAINER} py-6 text-[13px] text-(--lc-muted)`}>
          MIT License · Built by {siteConfig.name} contributors · Not affiliated with GitHub
        </p>
      </div>
    </footer>
  );
}
