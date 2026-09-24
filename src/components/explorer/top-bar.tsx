"use client";

import {
  CalendarClock,
  ChartColumn,
  CircleQuestionMark,
  ExternalLink,
  Gamepad2,
  GitFork,
  ScrollText,
  Search,
  Share2,
  Spline,
  Star,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { githubTreeUrl } from "@/analysis/source-protocol";
import { LogoMark } from "@/components/brand/logo-mark";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd, LanguageDot } from "@/components/ui/primitives";
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

function RepositoryIdentity({ repository }: { repository: RepositoryInfo }) {
  const url = safeExternalUrl(repository.url);
  const languageId = languageIdForName(repository.language);
  const shortSha = repository.commitSha.slice(0, 7);
  return (
    <div className="min-w-0">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${repository.fullName} on GitHub (opens in a new tab)`}
          className="group flex min-w-0 items-center gap-1.5 rounded font-mono text-sm text-ink"
        >
          <span className="truncate">
            <span className="text-ink-muted">{repository.owner}/</span>
            {repository.name}
          </span>
          <ExternalLink aria-hidden="true" className="size-3 shrink-0 text-ink-subtle transition-colors group-hover:text-signal" />
        </a>
      ) : (
        <span className="block truncate font-mono text-sm text-ink">{repository.fullName}</span>
      )}
      <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-ink-subtle max-sm:hidden">
        <span className="inline-flex items-center gap-1" title={`${formatInteger(repository.stars)} stars`}>
          <Star aria-hidden="true" className="size-3" />
          <span aria-hidden="true">{formatCompact(repository.stars)}</span>
          <span className="sr-only">{`${formatInteger(repository.stars)} stars`}</span>
        </span>
        <span className="inline-flex items-center gap-1" title={`${formatInteger(repository.forks)} forks`}>
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
        <a
          href={githubTreeUrl(repository.owner, repository.name, repository.commitSha, "")}
          target="_blank"
          rel="noopener noreferrer"
          title={`Analysed commit ${repository.commitSha} (${repository.ref})`}
          aria-label={`Analysed commit ${shortSha} on GitHub (opens in a new tab)`}
          className="rounded font-mono text-ink-subtle transition-colors hover:text-signal"
        >
          @{shortSha}
        </a>
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
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2 p-2 animate-fade-in md:p-3 xl:flex-row xl:items-center xl:gap-3">
      <div className="glass pointer-events-auto flex min-w-0 max-w-full items-center gap-2.5 self-start rounded-xl py-1.5 pl-1.5 pr-3 xl:max-w-[26rem] xl:self-auto">
        <Link href="/" aria-label="CodeVerse home" className="shrink-0 rounded-lg p-1 transition-colors hover:bg-panel-raised">
          <LogoMark className="size-7" knockout="#0b111c" />
        </Link>
        <span aria-hidden="true" className="h-7 w-px shrink-0 bg-line-strong" />
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
          className="glass inline-flex h-10 shrink-0 items-center gap-2 rounded-xl pl-3 pr-2 text-sm text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="max-lg:hidden">Search</span>
          <Kbd className="max-lg:hidden">/</Kbd>
        </button>

        {worldEnabled ? <ModeSwitcher className="shrink-0" /> : null}

        <div className="glass flex shrink-0 items-center gap-0.5 rounded-xl p-0.5">
          {worldEnabled ? (
            <>
              <IconButton label="Dependency lines" shortcut="L" pressed={showDependencies} icon={<Spline />} onClick={() => toggleDependencies()} />
              <IconButton
                label="Explore mode"
                shortcut="G"
                pressed={navigationMode === "explore"}
                icon={<Gamepad2 />}
                onClick={() => setNavigationMode(navigationMode === "orbit" ? "explore" : "orbit")}
              />
              <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line-strong" />
            </>
          ) : null}
          <IconButton label="History timeline" shortcut="T" pressed={timelineActive} icon={<CalendarClock />} onClick={() => setTimeline({ active: !timelineActive })} />
          <IconButton label="Repository statistics" shortcut="I" pressed={panels.analytics} icon={<ChartColumn />} onClick={() => togglePanel("analytics")} />
          <IconButton label="Contributors" pressed={panels.contributors} icon={<UsersRound />} onClick={() => togglePanel("contributors")} />
          {worldEnabled ? (
            <IconButton label="Text summary" pressed={panels.summary} icon={<ScrollText />} onClick={() => togglePanel("summary")} />
          ) : null}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line-strong" />
          {/* Last group: right-aligned tooltips stay on screen at the viewport edge. */}
          <IconButton label="Share this view" tooltipAlign="end" icon={<Share2 />} onClick={() => setPanel("share", true)} />
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
