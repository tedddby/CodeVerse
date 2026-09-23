/**
 * Public, client-safe site configuration. Nothing secret belongs here.
 * Rename the product by editing this file (and the README).
 */
export const siteConfig = {
  name: "CodeVerse",
  tagline: "See your codebase from a different dimension.",
  headline: "Explore any codebase as a 3D universe.",
  description:
    "Paste a GitHub repository and fly through its architecture, dependencies, history, and code.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  repositoryUrl: process.env.NEXT_PUBLIC_REPOSITORY_URL ?? "https://github.com/codeverse-oss/codeverse",
  exampleRepositories: [
    { owner: "facebook", repo: "react", blurb: "UI library monorepo" },
    { owner: "vercel", repo: "next.js", blurb: "Full-stack React framework" },
    { owner: "nodejs", repo: "node", blurb: "JavaScript runtime" },
    { owner: "torvalds", repo: "linux", blurb: "Kernel — directory-first mode" },
  ],
} as const;

export type ExampleRepository = (typeof siteConfig.exampleRepositories)[number];
