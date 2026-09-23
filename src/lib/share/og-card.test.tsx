import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import { createSyntheticGraph } from "@/fixtures/fixture-builder";
import { mockRepositoryGraph } from "@/fixtures/mock-repository-graph";
import { RepositoryOgCard } from "./og-card";
import { buildRepositoryCardData } from "./og-image-data";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Renders through Satori + resvg exactly like the route does; throws on unsupported CSS/markup. */
async function renderPng(element: React.ReactElement): Promise<Uint8Array> {
  const response = new ImageResponse(element, { width: 1200, height: 630 });
  return new Uint8Array(await response.arrayBuffer());
}

describe("RepositoryOgCard", () => {
  it("renders the real city map card to a PNG", async () => {
    const data = buildRepositoryCardData({
      owner: "codeverse-demo",
      repo: "acme-platform",
      summary: null,
      graph: mockRepositoryGraph,
      host: "codeverse.dev",
      siteName: "CodeVerse",
    });
    const png = await renderPng(<RepositoryOgCard {...data} />);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });

  it("renders a large repository's map quickly (thumbnail is one embedded SVG)", async () => {
    const data = buildRepositoryCardData({
      owner: "big",
      repo: "repo",
      summary: null,
      graph: createSyntheticGraph({ fileCount: 2_500, seed: 11 }),
      host: "codeverse.dev",
      siteName: "CodeVerse",
    });
    expect(data.thumbnail.buildings).toHaveLength(1_500);
    const started = performance.now();
    const png = await renderPng(<RepositoryOgCard {...data} />);
    // Thousands of positioned boxes took ~25s in Satori; the SVG path takes well under a second.
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
  });

  it("renders the abstract placeholder with long, hostile text safely", async () => {
    const data = buildRepositoryCardData({
      owner: "a-very-long-organisation-name",
      repo: "an-extremely-long-repository-name-that-keeps-going-and-going",
      summary: {
        fullName: "a-very-long-organisation-name/an-extremely-long-repository-name-that-keeps-going-and-going",
        stars: 1_234_567,
        forks: 89_012,
        language: "TypeScript",
        description: `🚀 <script>alert(1)</script> ${"A description that is far too long for a social card. ".repeat(6)}`,
      },
      graph: null,
      host: "codeverse.dev",
      siteName: "CodeVerse",
    });
    const png = await renderPng(<RepositoryOgCard {...data} />);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
  });
});
