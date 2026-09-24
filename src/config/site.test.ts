import { describe, expect, it } from "vitest";
import {
  OFFICIAL_REPOSITORY_URL,
  OFFICIAL_SITE_URL,
  resolveRepositoryUrl,
  resolveSiteUrl,
} from "./site";

describe("resolveSiteUrl", () => {
  it("prefers an explicit NEXT_PUBLIC_SITE_URL, without a trailing slash", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://code.example.org/",
        VERCEL_PROJECT_PRODUCTION_URL: "ignored.vercel.app",
        NODE_ENV: "production",
      }),
    ).toBe("https://code.example.org");
  });

  it("uses the Vercel production domain when no URL is configured", () => {
    expect(
      resolveSiteUrl({
        VERCEL_PROJECT_PRODUCTION_URL: "codeverse.awab.tech",
        NODE_ENV: "production",
      }),
    ).toBe("https://codeverse.awab.tech");
    expect(
      resolveSiteUrl({ NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "https://my-fork.vercel.app/" }),
    ).toBe("https://my-fork.vercel.app");
  });

  it("falls back to the official site in production and localhost in development", () => {
    expect(resolveSiteUrl({ NODE_ENV: "production" })).toBe(OFFICIAL_SITE_URL);
    expect(resolveSiteUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("treats blank values as unset (e.g. an empty Docker build argument)", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "  ", NODE_ENV: "production" })).toBe(
      OFFICIAL_SITE_URL,
    );
  });

  it("always yields a URL that metadata and sitemaps can resolve against", () => {
    for (const env of [
      {},
      { NODE_ENV: "production" },
      { VERCEL_PROJECT_PRODUCTION_URL: "x.dev" },
    ]) {
      expect(() => new URL("/sitemap.xml", resolveSiteUrl(env))).not.toThrow();
    }
  });
});

describe("resolveRepositoryUrl", () => {
  it("defaults to the official repository and honours overrides", () => {
    expect(resolveRepositoryUrl({})).toBe(OFFICIAL_REPOSITORY_URL);
    expect(
      resolveRepositoryUrl({ NEXT_PUBLIC_REPOSITORY_URL: "https://github.com/me/fork/" }),
    ).toBe("https://github.com/me/fork");
  });
});
