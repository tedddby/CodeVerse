"use client";

import { ExternalLink } from "lucide-react";
import { useId } from "react";
import { githubTreeUrl } from "@/analysis/source-protocol";
import { ButtonLink } from "@/components/ui/button";
import { LanguageDot, Stat } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { DirectoryNode } from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { formatBytes, formatCompact, formatInteger, pluralize } from "@/lib/utils/format";
import { DetailsSection } from "./details-section";

/** Details of a directory selected in the summary tree: size, languages, omitted files. */
export function DirectoryDetails({
  index,
  directory,
}: {
  index: GraphIndex;
  directory: DirectoryNode;
}) {
  const { repository } = index.graph;
  const { stats } = directory;
  const titleId = useId();
  const total = Object.values(stats.languageBytes).reduce((sum, bytes) => sum + bytes, 0);
  const languages = Object.entries(stats.languageBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <article aria-labelledby={titleId}>
      <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">Directory</p>
      <h3 id={titleId} className="text-ink mt-0.5 font-mono text-sm font-semibold break-all">
        {directory.path === "" ? repository.name : `${directory.path}/`}
      </h3>
      <dl className="mt-3 space-y-1">
        <Stat
          label="Files"
          value={formatInteger(stats.fileCount)}
          hint={`${formatInteger(stats.directFileCount)} direct`}
        />
        <Stat label="Subdirectories" value={formatInteger(stats.directDirectoryCount)} />
        <Stat
          label="Lines"
          value={`${stats.linesEstimated ? "~" : ""}${formatCompact(stats.totalLines)}`}
        />
        <Stat label="Size" value={formatBytes(stats.totalBytes)} />
        <Stat label="Symbols" value={formatInteger(stats.symbolCount)} />
      </dl>
      {stats.omittedFileCount > 0 ? (
        <p className="text-ink-subtle mt-1.5 text-xs">
          {pluralize(stats.omittedFileCount, "file")} in this directory{" "}
          {stats.omittedFileCount === 1 ? "was" : "were"} not included in the analysis.
        </p>
      ) : null}
      {languages.length > 0 && total > 0 ? (
        <DetailsSection label="Languages">
          <ul className="space-y-0.5">
            {languages.map(([id, bytes]) => (
              <li key={id} className="text-ink-muted flex items-center gap-2 text-xs">
                <LanguageDot language={id} />
                <span className="flex-1">{getLanguage(id).name}</span>
                <span className="font-mono tabular-nums">{Math.round((bytes / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </DetailsSection>
      ) : null}
      {repository.provider === "github" ? (
        <div className="mt-3">
          <ButtonLink
            href={githubTreeUrl(
              repository.owner,
              repository.name,
              repository.commitSha,
              directory.path,
            )}
            external
            size="sm"
            variant="ghost"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Open on GitHub
          </ButtonLink>
        </div>
      ) : null}
    </article>
  );
}
