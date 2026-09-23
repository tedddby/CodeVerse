import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // API routes stream analyses and proxy file contents; crawling them only burns GitHub quota.
      disallow: "/api/",
    },
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}
