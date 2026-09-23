import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExplorerApp } from "@/components/explorer/explorer-app";
import { siteConfig } from "@/config/site";
import { describeRepositoryForMetadata, genericRepositoryDescription, withTimeout } from "@/lib/share/metadata";
import { decodeShareState, searchParamsFromRecord } from "@/lib/share/url-state";
import { explorePath } from "@/lib/validation/repository-url";
import { fetchRepositorySummary } from "@/sources/github";
import { parseRepositoryParams } from "./route-params";

type ExplorePageProps = PageProps<"/explore/[owner]/[repo]">;

/** Repository metadata is optional enrichment: never let a slow GitHub delay the page. */
const METADATA_TIMEOUT_MS = 2_500;

export async function generateMetadata({ params }: ExplorePageProps): Promise<Metadata> {
  const parsed = parseRepositoryParams(await params);
  if (!parsed) {
    return { title: "Repository not found", robots: { index: false, follow: false } };
  }
  const { owner, repo } = parsed;
  const fullName = `${owner}/${repo}`;
  const title = `Explore ${fullName} in 3D`;
  const canonical = explorePath(owner, repo);

  const summary = await withTimeout((signal) => fetchRepositorySummary(owner, repo, signal), METADATA_TIMEOUT_MS);
  const description = summary ? describeRepositoryForMetadata(summary) : genericRepositoryDescription(fullName);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ExplorePage({ params, searchParams }: ExplorePageProps) {
  const parsed = parseRepositoryParams(await params);
  if (!parsed) notFound();
  const initialShareState = decodeShareState(searchParamsFromRecord(await searchParams));
  // Keyed so navigating between repositories (or refs) starts from a clean slate.
  const key = `${parsed.owner}/${parsed.repo}@${initialShareState.ref ?? ""}`;
  return <ExplorerApp key={key} owner={parsed.owner} repo={parsed.repo} initialShareState={initialShareState} />;
}
