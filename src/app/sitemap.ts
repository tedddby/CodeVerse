import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { explorePath } from "@/lib/validation/repository-url";

/** Home page plus the curated example explorations. */
export default function sitemap(): MetadataRoute.Sitemap {
  const absolute = (path: string) => new URL(path, siteConfig.url).toString();
  return [
    { url: absolute("/"), changeFrequency: "weekly", priority: 1 },
    ...siteConfig.exampleRepositories.map(({ owner, repo }) => ({
      url: absolute(explorePath(owner, repo)),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
