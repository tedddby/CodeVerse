import { siteConfig } from "@/config/site";

/** DOM id of the landing page's repository input (focus target for CTAs). */
export const REPOSITORY_INPUT_ID = "repository-input";

/** In-page anchors, in document order. */
export const SECTION_IDS = {
  main: "main-content",
  demo: "demo",
  howItWorks: "how-it-works",
  features: "features",
  examples: "examples",
  openSource: "open-source",
} as const;

function repositoryFile(path: string): string {
  return `${siteConfig.repositoryUrl.replace(/\/+$/, "")}/blob/main/${path}`;
}

/** Project documentation lives in the repository; the site links to it there. */
export const PROJECT_LINKS = {
  repository: siteConfig.repositoryUrl,
  architecture: repositoryFile("docs/ARCHITECTURE.md"),
  privacy: repositoryFile("docs/PRIVACY.md"),
  security: repositoryFile("SECURITY.md"),
  contributing: repositoryFile("CONTRIBUTING.md"),
  license: repositoryFile("LICENSE"),
  selfHosting: `${siteConfig.repositoryUrl.replace(/\/+$/, "")}#deployment`,
} as const;
