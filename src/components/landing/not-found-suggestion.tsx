"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { suggestRepositoryFromPath } from "./path-suggestion";

/** "Did you mean …?" link for 404s whose path looks like a repository. */
export function NotFoundSuggestion() {
  const pathname = usePathname();
  const suggestion = pathname ? suggestRepositoryFromPath(pathname) : null;
  if (!suggestion) return null;
  return (
    <p className="text-ink-muted mt-6 text-sm">
      Looking for a repository?{" "}
      <Link
        href={suggestion.href}
        className="text-signal inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
      >
        Explore {suggestion.label}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </p>
  );
}
