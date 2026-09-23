import { computeWorldLayout } from "@/engine/layout/compute-layout";
import type { RepositoryGraph } from "@/graph/model/types";
import { getLanguage, getLanguageColor, LANGUAGES } from "@/lib/languages/registry";
import type { RepositoryMetadataSource } from "./metadata";
import { OG_THUMBNAIL_SIZE, type RepositoryCardData } from "./og-card";
import { generateAbstractMap, projectCityMap, type OgThumbnail } from "./og-thumbnail";

/**
 * Assembles the data for a repository's social card from whatever is
 * available: provider metadata (optional) and the latest cached graph
 * (optional). Never throws for missing inputs; the card degrades gracefully.
 */

const SIGNAL = "#4de2ff";

/** Registry language matching a provider language name ("TypeScript", "C++"). */
export function languageForProviderName(name: string | undefined): { name: string; color: string } | null {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  const match = LANGUAGES.find((language) => language.name.toLowerCase() === lower);
  return match ? { name: match.name, color: match.color } : { name: name.trim(), color: SIGNAL };
}

/** Top-down city map of the cached graph, or null when it cannot be laid out. */
export function cityThumbnail(graph: RepositoryGraph): OgThumbnail | null {
  try {
    const layout = computeWorldLayout(graph);
    if (layout.buildings.length === 0) return null;
    const languageByFile = new Map(graph.files.map((file) => [file.id, file.language] as const));
    return projectCityMap(layout, (id) => getLanguageColor(languageByFile.get(id) ?? "unknown"), {
      ...OG_THUMBNAIL_SIZE,
      padding: 16,
    });
  } catch {
    return null;
  }
}

export interface RepositoryCardInput {
  owner: string;
  repo: string;
  summary: RepositoryMetadataSource | null;
  graph: RepositoryGraph | null;
  host: string;
  siteName: string;
}

export function buildRepositoryCardData({ owner, repo, summary, graph, host, siteName }: RepositoryCardInput): RepositoryCardData {
  const primaryGraphLanguage = graph?.languages.find((language) => language.id !== "unknown");
  const language =
    languageForProviderName(summary?.language ?? graph?.repository.language) ??
    (primaryGraphLanguage ? { name: getLanguage(primaryGraphLanguage.id).name, color: primaryGraphLanguage.color } : null);

  // Prefer the provider's canonical casing ("facebook/react") over the URL's.
  const canonical = summary?.fullName ?? graph?.repository.fullName;
  const [canonicalOwner, canonicalRepo] = canonical?.split("/") ?? [];
  const displayOwner = canonicalOwner && canonicalOwner.toLowerCase() === owner.toLowerCase() ? canonicalOwner : owner;
  const displayRepo = canonicalRepo && canonicalRepo.toLowerCase() === repo.toLowerCase() ? canonicalRepo : repo;

  const thumbnail =
    (graph ? cityThumbnail(graph) : null) ??
    generateAbstractMap(`${owner.toLowerCase()}/${repo.toLowerCase()}`, language?.color ?? SIGNAL, OG_THUMBNAIL_SIZE);

  return {
    owner: displayOwner,
    repo: displayRepo,
    description: summary?.description ?? graph?.repository.description,
    stars: summary?.stars ?? graph?.repository.stars,
    forks: summary?.forks ?? graph?.repository.forks,
    language: language ?? undefined,
    thumbnail,
    host,
    siteName,
  };
}

/** Host shown on cards ("codeverse.dev"), tolerant of a misconfigured site URL. */
export function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}
