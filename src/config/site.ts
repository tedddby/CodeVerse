/**
 * Public, client-safe site configuration. Nothing secret belongs here.
 * Rename the product by editing this file (and the README).
 */

/** The official deployment. Self-hosters set NEXT_PUBLIC_SITE_URL instead. */
export const OFFICIAL_SITE_URL = "https://codeverse.awab.tech";
/** The project's source repository. Forks set NEXT_PUBLIC_REPOSITORY_URL instead. */
export const OFFICIAL_REPOSITORY_URL = "https://github.com/tedddby/CodeVerse";

type Env = Record<string, string | undefined>;

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Absolute origin used for canonical links, Open Graph images, robots and the
 * sitemap (all server-side), without a trailing slash:
 * 1. NEXT_PUBLIC_SITE_URL when set;
 * 2. on Vercel, the project's production domain (custom domain when one is
 *    configured), so preview deployments still point crawlers at production;
 * 3. the official deployment for production builds, localhost in development.
 */
export function resolveSiteUrl(env: Env = process.env): string {
  const explicit = nonBlank(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    nonBlank(env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL) ??
    nonBlank(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return env.NODE_ENV === "production" ? OFFICIAL_SITE_URL : "http://localhost:3000";
}

export function resolveRepositoryUrl(env: Env = process.env): string {
  return (nonBlank(env.NEXT_PUBLIC_REPOSITORY_URL) ?? OFFICIAL_REPOSITORY_URL).replace(/\/+$/, "");
}

export const siteConfig = {
  name: "CodeVerse",
  tagline: "See your codebase from a different dimension.",
  headline: "Explore any codebase as a 3D universe.",
  description:
    "Paste a GitHub repository and fly through its architecture, dependencies, history, and code.",
  url: resolveSiteUrl(),
  repositoryUrl: resolveRepositoryUrl(),
  exampleRepositories: [
    { owner: "facebook", repo: "react", blurb: "UI library monorepo" },
    { owner: "vercel", repo: "next.js", blurb: "Full-stack React framework" },
    { owner: "nodejs", repo: "node", blurb: "JavaScript runtime" },
    { owner: "torvalds", repo: "linux", blurb: "Kernel — directory-first mode" },
  ],
} as const;

export type ExampleRepository = (typeof siteConfig.exampleRepositories)[number];
