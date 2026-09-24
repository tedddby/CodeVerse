import { describe, expect, it } from "vitest";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { getLanguageColor } from "@/lib/languages/registry";
import {
  buildRepositoryCardData,
  cityThumbnail,
  languageForProviderName,
  siteHost,
} from "./og-image-data";

const base = { host: "codeverse.dev", siteName: "CodeVerse" };

describe("buildRepositoryCardData", () => {
  it("draws the real city map when a cached graph exists", () => {
    const data = buildRepositoryCardData({
      ...base,
      owner: "codeverse-demo",
      repo: "acme-platform",
      summary: null,
      graph: mockRepositoryGraph,
    });
    expect(data.thumbnail.kind).toBe("city");
    expect(data.thumbnail.totalBuildings).toBe(mockRepositoryGraph.files.length);
    expect(data.stars).toBe(mockRepositoryGraph.repository.stars);
    const colors = new Set(data.thumbnail.buildings.map((building) => building.color));
    expect(colors.has(getLanguageColor("typescript"))).toBe(true);
  });

  it("falls back to a deterministic abstract map without a graph", () => {
    const input = {
      ...base,
      owner: "Facebook",
      repo: "React",
      summary: {
        fullName: "facebook/react",
        stars: 238_000,
        forks: 49_000,
        language: "JavaScript",
        description: "UI library",
      },
      graph: null,
    };
    const data = buildRepositoryCardData(input);
    expect(data.thumbnail.kind).toBe("abstract");
    expect(data).toMatchObject({
      owner: "facebook",
      repo: "react",
      stars: 238_000,
      forks: 49_000,
      description: "UI library",
    });
    expect(data.language).toEqual({ name: "JavaScript", color: getLanguageColor("javascript") });
    // Same repository, different URL casing -> same artwork.
    expect(
      buildRepositoryCardData({ ...input, owner: "facebook", repo: "react" }).thumbnail,
    ).toEqual(data.thumbnail);
  });

  it("does not adopt canonical names that do not match the requested repository", () => {
    const data = buildRepositoryCardData({
      ...base,
      owner: "a",
      repo: "b",
      summary: { fullName: "other/name", stars: 0, forks: 0 },
      graph: null,
    });
    expect(data).toMatchObject({ owner: "a", repo: "b" });
    expect(data.language).toBeUndefined();
  });
});

describe("helpers", () => {
  it("returns a city thumbnail for the mock graph", () => {
    expect(cityThumbnail(mockRepositoryGraph)?.buildings.length).toBe(
      mockRepositoryGraph.files.length,
    );
  });

  it("maps provider language names to registry colors", () => {
    expect(languageForProviderName("typescript")).toEqual({
      name: "TypeScript",
      color: getLanguageColor("typescript"),
    });
    expect(languageForProviderName("Brainfuck")).toEqual({ name: "Brainfuck", color: "#4de2ff" });
    expect(languageForProviderName(undefined)).toBeNull();
  });

  it("extracts the host from the site URL", () => {
    expect(siteHost("https://codeverse.dev/")).toBe("codeverse.dev");
    expect(siteHost("http://localhost:3000")).toBe("localhost:3000");
    expect(siteHost("not a url/path")).toBe("not a url");
  });
});
