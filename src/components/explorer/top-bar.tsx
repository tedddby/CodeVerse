"use client";

import {
  CalendarClock,
  ChartColumn,
  CircleQuestionMark,
  ExternalLink,
  Gamepad2,
  GitCommitHorizontal,
  GitFork,
  ScrollText,
  Search,
  Share2,
  Spline,
  Star,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { githubTreeUrl } from "@/analysis/source-protocol";
import { LogoMark } from "@/components/brand/logo-mark";
import { escapeHiddenCharacters } from "@/components/code-viewer/hidden-characters";
import { revealHiddenCharacters } from "@/components/code-viewer/revealed-text";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd, LanguageDot } from "@/components/ui/primitives";
import { isCommitSha } from "@/github/validation";
import type { RepositoryInfo } from "@/graph/model/types";
import { LANGUAGES } from "@/lib/languages/registry";
import { formatCompact, formatInteger } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { ModeSwitcher } from "./mode-switcher";

/** Only http(s) URLs from repository metadata are ever linked. */
export function safeExternalUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Registry language id for a provider language name ("TypeScript" -> "typescript"). */
function languageIdForName(name: string | undefined): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return LANGUAGES.find((language) => language.name.toLowerCase() === lower)?.id ?? null;
}

/**
 * "Viewing commit abc1234", shown when the page pins a full commit SHA (a
 * shared link or permalink) instead of a branch or tag. GitHub serves every
 * commit of a repository's fork network under the repository's name, so such
 * a commit may not belong to any branch of this repository.
 */
function PinnedCommitNotice({ repository }: { repository: RepositoryInfo }) {
  const descriptionId = useId();
  const shortSha = repository.commitSha.slice(0, 7);
  const explanation = `Pinned to commit ${repository.commitSha}. It may not belong to any branch of this repository (GitHub also serves commits from forks under this repository's name).`;
  return (
    <>
      <a
        href={githubTreeUrl(repository.owner, repository.name, repository.commitSha, "")}
        target="_blank"
        rel="noopener noreferrer"
        title={explanation}
        aria-label={`Viewing commit ${shortSha} on GitHub (opens in a new tab)`}
        aria-describedby={descriptionId}
        className="border-flare/40 bg-flare/10 text-flare hover:border-flare/70 inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] leading-none transition-colors"
      >
        <GitCommitHorizontal aria-hidden="true" className="size-3" />
        <span className="max-sm:hidden">Viewing commit</span>{" "}
        <span className="font-mono">{shortSha}</span>
      </a>
      <span id={descriptionId} className="sr-only">
        {explanation}
      </span>
    </>
  );
}

function RepositoryIdentity({ repository }: { repository: RepositoryInfo }) {
  const url = safeExternalUrl(repository.url);
  const languageId = languageIdForName(repository.language);
  const shortSha = repository.commitSha.slice(0, 7);
  const pinned = isCommitSha(repository.ref);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${escapeHiddenCharacters(repository.fullName)} on GitHub (opens in a new tab)`}
            className="group text-ink flex min-w-0 items-center gap-1.5 rounded font-mono text-sm"
          >
            <span className="truncate">
              <span className="text-ink-muted">{revealHiddenCharacters(repository.owner)}/</span>
              {revealHiddenCharacters(repository.name)}
            </span>
            <ExternalLink
              aria-hidden="true"
              className="text-ink-subtle group-hover:text-signal size-3 shrink-0 transition-colors"
            />
          </a>
        ) : (
          <span className="text-ink block min-w-0 truncate font-mono text-sm">
            {revealHiddenCharacters(repository.fullName)}
          </span>
        )}
        {pinned ? <PinnedCommitNotice repository={repository} /> : null}
      </div>
      <div className="text-ink-subtle mt-0.5 flex items-center gap-2.5 text-[11px] max-sm:hidden">
        <span
          className="inline-flex items-center gap-1"
          title={`${formatInteger(repository.stars)} stars`}
        >
          <Star aria-hidden="true" className="size-3" />
          <span aria-hidden="true">{formatCompact(repository.stars)}</span>
          <span className="sr-only">{`${formatInteger(repository.stars)} stars`}</span>
        </span>
        <span
          className="inline-flex items-center gap-1"
          title={`${formatInteger(repository.forks)} forks`}
        >
          <GitFork aria-hidden="true" className="size-3" />
          <span aria-hidden="true">{formatCompact(repository.forks)}</span>
          <span className="sr-only">{`${formatInteger(repository.forks)} forks`}</span>
        </span>
        {repository.language ? (
          <span className="inline-flex items-center gap-1.5">
            {languageId ? <LanguageDot language={languageId} /> : null}
            {repository.language}
          </span>
        ) : null}
        {/* A pinned commit is already named next to the repository. */}
        {pinned ? null : (
          <a
            href={githubTreeUrl(repository.owner, repository.name, repository.commitSha, "")}
            target="_blank"
            rel="noopener noreferrer"
            title={`Analysed commit ${repository.commitSha} (${escapeHiddenCharacters(repository.ref)})`}
            aria-label={`Analysed commit ${shortSha} on GitHub (opens in a new tab)`}
            className="text-ink-subtle hover:text-signal rounded font-mono transition-colors"
          >
            @{shortSha}
          </a>
        )}
      </div>
    </div>
  );
}

export interface TopBarProps {
  /** False when the 3D world is replaced by the text summary (no WebGL). */
  worldEnabled: boolean;
}

/** Explorer header: identity, search, visual modes and tool toggles. */
export function TopBar({ worldEnabled }: TopBarProps) {
  const repository = useExplorerStore((state) => state.graph?.repository ?? null);
  const showDependencies = useExplorerStore((state) => state.showDependencies);
  const navigationMode = useExplorerStore((state) => state.navigationMode);
  const timelineActive = useExplorerStore((state) => state.timeline.active);
  const panels = useExplorerStore((state) => state.panels);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const togglePanel = useExplorerStore((state) => state.togglePanel);
  const toggleDependencies = useExplorerStore((state) => state.toggleDependencies);
  const setNavigationMode = useExplorerStore((state) => state.setNavigationMode);
  const setTimeline = useExplorerStore((state) => state.setTimeline);

  return (
    <header className="animate-fade-in pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2 p-2 md:p-3 xl:flex-row xl:items-center xl:gap-3">
      <div className="glass pointer-events-auto flex max-w-full min-w-0 items-center gap-2.5 self-start rounded-xl py-1.5 pr-3 pl-1.5 xl:max-w-[26rem] xl:self-auto">
        <Link
          href="/"
          aria-label="CodeVerse home"
          className="hover:bg-panel-raised shrink-0 rounded-lg p-1 transition-colors"
        >
          <LogoMark className="size-7" knockout="#0b111c" />
        </Link>
        <span aria-hidden="true" className="bg-line-strong h-7 w-px shrink-0" />
        {repository ? <RepositoryIdentity repository={repository} /> : null}
      </div>

      <nav
        aria-label="Explorer tools"
        className="pointer-events-auto flex min-w-0 items-center gap-2 max-md:-mx-2 max-md:overflow-x-auto max-md:px-2 max-md:pb-1 md:flex-wrap xl:ml-auto xl:flex-nowrap"
      >
        <button
          type="button"
          onClick={() => setPanel("search", true)}
          aria-label="Search files and symbols (/)"
          className="glass text-ink-muted hover:border-line-strong hover:text-ink inline-flex h-10 shrink-0 items-center gap-2 rounded-xl pr-2 pl-3 text-sm transition-colors"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="max-lg:hidden">Search</span>
          <Kbd className="max-lg:hidden">/</Kbd>
        </button>

        {worldEnabled ? <ModeSwitcher className="shrink-0" /> : null}

        <div className="glass flex shrink-0 items-center gap-0.5 rounded-xl p-0.5">
          {worldEnabled ? (
            <>
              <IconButton
                label="Dependency lines"
                shortcut="L"
                pressed={showDependencies}
                icon={<Spline />}
                onClick={() => toggleDependencies()}
              />
              <IconButton
                label="Explore mode"
                shortcut="G"
                pressed={navigationMode === "explore"}
                icon={<Gamepad2 />}
                onClick={() => setNavigationMode(navigationMode === "orbit" ? "explore" : "orbit")}
              />
              <span aria-hidden="true" className="bg-line-strong mx-0.5 h-5 w-px" />
            </>
          ) : null}
          <IconButton
            label="History timeline"
            shortcut="T"
            pressed={timelineActive}
            icon={<CalendarClock />}
            onClick={() => setTimeline({ active: !timelineActive })}
          />
          <IconButton
            label="Repository statistics"
            shortcut="I"
            pressed={panels.analytics}
            icon={<ChartColumn />}
            onClick={() => togglePanel("analytics")}
          />
          <IconButton
            label="Contributors"
            pressed={panels.contributors}
            icon={<UsersRound />}
            onClick={() => togglePanel("contributors")}
          />
          {worldEnabled ? (
            <IconButton
              label="Text summary"
              pressed={panels.summary}
              icon={<ScrollText />}
              onClick={() => togglePanel("summary")}
            />
          ) : null}
          <span aria-hidden="true" className="bg-line-strong mx-0.5 h-5 w-px" />
          {/* Last group: right-aligned tooltips stay on screen at the viewport edge. */}
          <IconButton
            label="Share this view"
            tooltipAlign="end"
            icon={<Share2 />}
            onClick={() => setPanel("share", true)}
          />
          <IconButton
            label="Keyboard shortcuts"
            shortcut="?"
            tooltipAlign="end"
            pressed={panels.shortcuts}
            icon={<CircleQuestionMark />}
            onClick={() => togglePanel("shortcuts")}
          />
        </div>
      </nav>
    </header>
  );
}
