"use client";

import { ExternalLink, FolderOpen, X } from "lucide-react";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { SectionLabel, Stat } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { ContributorNode } from "@/graph/model/types";
import { formatCompact, formatInteger, formatRelativeTime, pluralize } from "@/lib/utils/format";
import { safeHttpsUrl } from "./analytics-model";
import { ContributorAvatar } from "./contributor-avatar";
import {
  historyWindowDescription,
  mostActiveAreas,
  noFileChangesNote,
  recentCommits,
} from "./contributors-model";

export interface ContributorDetailProps {
  index: GraphIndex;
  contributor: ContributorNode;
  onClear: () => void;
  onFocusDirectory: (directoryId: string) => void;
}

/** Details for the active contributor: activity in the analysed window, areas and recent commits. */
export function ContributorDetail({
  index,
  contributor,
  onClear,
  onFocusDirectory,
}: ContributorDetailProps) {
  const profileUrl = safeHttpsUrl(contributor.profileUrl);
  const areas = mostActiveAreas(index, contributor, 3);
  const commits = recentCommits(index.graph, contributor.id, 6);
  const windowText = historyWindowDescription(index.graph);
  const noFilesNote = noFileChangesNote(index.graph, contributor);

  return (
    <section
      aria-label={`Contributor details: ${escapeHiddenCharacters(contributor.name)}`}
      className="border-signal/25 bg-signal/[0.04] rounded-xl border p-3"
    >
      <div className="flex items-start gap-3">
        <ContributorAvatar contributor={contributor} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            Contributor
          </p>
          {profileUrl ? (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink hover:text-signal inline-flex max-w-full items-center gap-1 truncate text-sm font-semibold"
            >
              <span className="truncate">{revealHiddenCharacters(contributor.name)}</span>
              <ExternalLink aria-hidden="true" className="text-ink-subtle size-3 shrink-0" />
              <span className="sr-only">(profile, opens in a new tab)</span>
            </a>
          ) : (
            <p className="text-ink truncate text-sm font-semibold">
              {revealHiddenCharacters(contributor.name)}
            </p>
          )}
          {contributor.login && contributor.login !== contributor.name ? (
            <p className="text-ink-subtle truncate font-mono text-[11px]">
              @{revealHiddenCharacters(contributor.login)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="border-line-strong text-ink-muted hover:bg-panel-raised hover:text-ink flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors"
        >
          <X aria-hidden="true" className="size-3" />
          Clear
        </button>
      </div>

      <dl className="mt-3 space-y-1">
        <Stat label="Files touched" value={formatInteger(contributor.fileIds.length)} />
        <Stat label="Commits in window" value={formatInteger(contributor.commitCount)} />
        <Stat
          label="All-time contributions"
          value={contributor.contributions > 0 ? formatCompact(contributor.contributions) : "—"}
        />
      </dl>
      <p className="text-ink-subtle mt-1.5 text-[11px] leading-relaxed">
        {windowText
          ? `Files and commits are based on ${windowText}.`
          : "No commit history was available for this analysis."}
      </p>

      {noFilesNote ? (
        <p className="text-warn mt-2 text-[11px] leading-relaxed">{noFilesNote}</p>
      ) : null}

      {areas.length > 0 ? (
        <div className="mt-3">
          <SectionLabel className="mb-1.5">Most active areas</SectionLabel>
          <ul className="flex flex-wrap gap-1.5">
            {areas.map((area) => (
              <li key={area.directoryId}>
                <button
                  type="button"
                  onClick={() => onFocusDirectory(area.directoryId)}
                  title={`${pluralize(area.files, "file")} touched — fly to ${escapeHiddenCharacters(area.label)}`}
                  className="border-line-strong bg-panel-raised/60 text-ink-muted hover:border-signal/40 hover:text-signal flex max-w-[14rem] items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors"
                >
                  <FolderOpen aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{revealHiddenCharacters(area.label)}</span>
                  <span className="text-ink-subtle">{formatInteger(area.files)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {commits.length > 0 ? (
        <div className="mt-3">
          <SectionLabel className="mb-1.5">Recent commits</SectionLabel>
          <ul className="space-y-1">
            {commits.map((commit) => {
              const url = safeHttpsUrl(commit.url);
              const body = (
                <>
                  <span className="text-ink-muted group-hover:text-ink min-w-0 flex-1 truncate">
                    {revealHiddenCharacters(commit.message || commit.sha.slice(0, 7))}
                  </span>
                  <time dateTime={commit.date} className="text-ink-subtle shrink-0 text-[10.5px]">
                    {formatRelativeTime(commit.date)}
                  </time>
                </>
              );
              return (
                <li key={commit.sha} title={escapeHiddenCharacters(commit.message)}>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group hover:bg-panel-raised flex items-baseline gap-2 rounded px-1 py-0.5 text-xs"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="flex items-baseline gap-2 px-1 py-0.5 text-xs">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
