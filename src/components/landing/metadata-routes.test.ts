import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { siteConfig } from "@/config/site";

describe("sitemap", () => {
  it("lists the home page and every example exploration as absolute URLs", () => {
    const entries = sitemap();
    const origin = new URL(siteConfig.url).origin;
    expect(entries.map((entry) => entry.url)).toEqual([
      new URL("/", origin).toString(),
      ...siteConfig.exampleRepositories.map(({ owner, repo }) =>
        new URL(`/explore/${owner}/${repo}`, origin).toString(),
      ),
    ]);
    for (const entry of entries) expect(entry.url.startsWith(origin)).toBe(true);
    expect(entries[0]?.priority).toBe(1);
  });
});

describe("robots", () => {
  it("allows the site, keeps crawlers off the API and points at the sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ userAgent: "*", allow: "/", disallow: "/api/" });
    expect(result.sitemap).toBe(new URL("/sitemap.xml", siteConfig.url).toString());
  });
});
