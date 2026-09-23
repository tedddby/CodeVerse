import { ImageResponse } from "next/og";
import { peekCachedGraph } from "@/analysis/service";
import { SocialCard } from "@/components/brand/social-card";
import { loadSocialCardFonts } from "@/components/brand/social-card-fonts";
import { siteConfig } from "@/config/site";
import { withTimeout } from "@/lib/share/metadata";
import { cardText, RepositoryOgCard, type RepositoryCardData } from "@/lib/share/og-card";
import { buildRepositoryCardData, siteHost } from "@/lib/share/og-image-data";
import { fetchRepositorySummary } from "@/sources/github";
import { parseRepositoryParams } from "./route-params";

/**
 * Per-repository social preview: name, stats, language and a generated
 * thumbnail (the real city map when an analysis is cached, otherwise a clearly
 * labelled abstract placeholder). Any failure degrades to a branded card.
 */

export const alt = "A generated 3D city map of a GitHub repository, by CodeVerse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/** Regenerated hourly so a freshly analysed repository gets its real city map. */
export const revalidate = 3600;

const DATA_TIMEOUT_MS = 3_000;
/** Cache lifetimes: `ImageResponse` defaults to a one-year immutable header, which would pin placeholders. */
const CARD_MAX_AGE_S = 3_600;
const FALLBACK_MAX_AGE_S = 300;

type FontOptions = { fonts?: Awaited<ReturnType<typeof loadSocialCardFonts>> };

/**
 * Renders eagerly (ImageResponse otherwise renders lazily inside its body
 * stream, where a failure could no longer fall back) and sets a bounded cache.
 */
async function toResponse(image: ImageResponse, maxAgeSeconds: number): Promise<Response> {
  const body = await image.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=86400`,
    },
  });
}

function renderRepositoryCard(data: RepositoryCardData, fontOptions: FontOptions): Promise<Response> {
  return toResponse(new ImageResponse(<RepositoryOgCard {...data} />, { ...size, ...fontOptions }), CARD_MAX_AGE_S);
}

function renderFallbackCard(fontOptions: FontOptions, repository?: { owner: string; repo: string }): Promise<Response> {
  const image = new ImageResponse(
    (
      <SocialCard
        eyebrow={repository ? "Explore in 3D" : "Open source"}
        title={repository ? cardText(`${repository.owner}/${repository.repo}`, 48) : siteConfig.headline}
        subtitle={siteConfig.tagline}
        footer={siteHost(siteConfig.url)}
      />
    ),
    { ...size, ...fontOptions },
  );
  return toResponse(image, FALLBACK_MAX_AGE_S);
}

export default async function OpenGraphImage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const fonts = await loadSocialCardFonts().catch(() => []);
  const fontOptions: FontOptions = fonts.length > 0 ? { fonts } : {};
  const parsed = parseRepositoryParams(await params);
  if (!parsed) return renderFallbackCard(fontOptions);
  const { owner, repo } = parsed;

  try {
    const [summary, graph] = await Promise.all([
      withTimeout((signal) => fetchRepositorySummary(owner, repo, signal), DATA_TIMEOUT_MS),
      withTimeout(() => peekCachedGraph(owner, repo), DATA_TIMEOUT_MS),
    ]);
    const data = buildRepositoryCardData({
      owner,
      repo,
      summary,
      graph,
      host: siteHost(siteConfig.url),
      siteName: siteConfig.name,
    });
    return await renderRepositoryCard(data, fontOptions);
  } catch (error) {
    console.warn(
      "[codeverse] repository social image failed; serving the branded card:",
      error instanceof Error ? error.message : String(error),
    );
    return renderFallbackCard(fontOptions, { owner, repo });
  }
}
