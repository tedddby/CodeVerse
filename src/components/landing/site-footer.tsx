import { Logo } from "@/components/brand/logo";
import { siteConfig } from "@/config/site";
import { PROJECT_LINKS } from "./constants";

const FOOTER_LINKS = [
  { href: PROJECT_LINKS.repository, label: "GitHub" },
  { href: PROJECT_LINKS.architecture, label: "Architecture docs" },
  { href: PROJECT_LINKS.privacy, label: "Privacy" },
  { href: PROJECT_LINKS.security, label: "Security" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-line border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="text-ink-muted mt-3 text-sm">{siteConfig.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-muted hover:text-ink transition-colors"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-line/60 border-t">
        <p className="text-ink-muted mx-auto max-w-6xl px-4 py-5 font-mono text-[11px] sm:px-6">
          MIT License · Built by {siteConfig.name} contributors · Not affiliated with GitHub
        </p>
      </div>
    </footer>
  );
}
