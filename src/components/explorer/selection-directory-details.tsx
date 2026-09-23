"use client";

import { CornerDownRight, Crosshair, Folder } from "lucide-react";
import { Fragment, useMemo } from "react";
import { githubTreeUrl } from "@/analysis/source-protocol";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import type { GraphIndex } from "@/graph/model/graph-index";
import type { DirectoryNode, FileNode } from "@/graph/model/types";
import { formatBytes, formatCompact, formatInteger, pluralize } from "@/lib/utils/format";
import { useExplorerStore } from "@/state/explorer-store";
import { GitHubMark } from "@/components/brand/github-mark";
import {
  ActionButton,
  ActionLink,
  CopyButton,
  ExpandableList,
  LanguageBreakdown,
  NodeLink,
  PanelSection,
  PathBreadcrumb,
  StatTile,
} from "./selection-parts";

const LARGEST_FILES_SHOWN = 6;

export function DirectoryDetails({ directory, index }: { directory: DirectoryNode; index: GraphIndex }) {
  const focusDirectory = useExplorerStore((state) => state.focusDirectory);
  const focusedDirectoryId = useExplorerStore((state) => state.focusedDirectoryId);
  const issueCameraCommand = useExplorerStore((state) => state.issueCameraCommand);
  const repository = index.graph.repository;
  const { stats } = directory;
  const isRoot = directory.path === "";

  const subdirectories = useMemo(
    () =>
      directory.childDirectoryIds
        .map((id) => index.directoriesById.get(id))
        .filter((child) => child !== undefined)
        .sort((a, b) => b.stats.fileCount - a.stats.fileCount || a.name.localeCompare(b.name)),
    [directory, index],
  );

  const largestFiles = useMemo(() => {
    const files: FileNode[] = [];
    for (const id of index.filesUnder(directory.id)) {
      const file = index.filesById.get(id);
      if (file && file.status !== "binary") files.push(file);
    }
    return files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path)).slice(0, LARGEST_FILES_SHOWN);
  }, [directory, index]);

  const isFocused = focusedDirectoryId === directory.id;

  return (
    <div>
      {isRoot ? null : <PathBreadcrumb path={directory.path} index={index} />}

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <span>
          {pluralize(stats.fileCount, "file")} · {formatInteger(stats.totalLines)} LOC
        </span>
        {stats.linesEstimated ? (
          <Badge tone="warn" title="Includes line counts estimated from file sizes">
            estimated
          </Badge>
        ) : null}
      </p>

      {stats.omittedFileCount > 0 ? (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs leading-relaxed text-ink-muted">
          <Badge tone="warn">Partial</Badge>{" "}
          {pluralize(stats.omittedFileCount, "file")} in this directory {stats.omittedFileCount === 1 ? "was" : "were"} not
          included in the 3D world because of analysis limits. Counts above include them.
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-4 gap-1.5">
        <StatTile label="Files" value={formatCompact(stats.fileCount)} hint={formatInteger(stats.fileCount)} />
        <StatTile label="Folders" value={formatCompact(stats.directDirectoryCount)} hint="Direct sub-directories" />
        <StatTile label="Symbols" value={formatCompact(stats.symbolCount)} hint={formatInteger(stats.symbolCount)} />
        <StatTile label="Size" value={formatBytes(stats.totalBytes)} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionButton
          icon={<CornerDownRight />}
          onClick={() => focusDirectory(directory.id)}
          disabled={isFocused || isRoot}
          title={isRoot ? "This is the repository root" : "Shortcut: Enter"}
        >
          {isFocused ? "Inside this directory" : "Enter directory"}
        </ActionButton>
        <ActionButton icon={<Crosshair />} onClick={() => issueCameraCommand({ type: "focus-node", ref: { kind: "directory", id: directory.id } })}>
          Focus
        </ActionButton>
        <ActionLink
          icon={<GitHubMark />}
          href={githubTreeUrl(repository.owner, repository.name, repository.commitSha, directory.path)}
          label="Open on GitHub"
        />
        {isRoot ? null : <CopyButton text={directory.path} label="Copy path" />}
      </div>

      <PanelSection title="Languages">
        <LanguageBreakdown languageBytes={stats.languageBytes} />
      </PanelSection>

      {subdirectories.length > 0 ? (
        <PanelSection title={<Fragment>Sub-directories <span className="font-mono">{formatInteger(subdirectories.length)}</span></Fragment>}>
          <ExpandableList
            items={subdirectories}
            getKey={(child) => child.id}
            renderItem={(child) => (
              <span className="flex min-w-0 items-center gap-2">
                <Folder aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" />
                <NodeLink nodeRef={{ kind: "directory", id: child.id }} className="font-mono text-xs" title={child.path}>
                  {child.name}
                </NodeLink>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-subtle">{formatCompact(child.stats.fileCount)}</span>
              </span>
            )}
          />
        </PanelSection>
      ) : null}

      {largestFiles.length > 0 ? (
        <PanelSection title="Largest files">
          <ul className="space-y-0.5">
            {largestFiles.map((file) => (
              <li key={file.id} className="flex min-w-0 items-center gap-2">
                <LanguageDot language={file.language} />
                <NodeLink nodeRef={{ kind: "file", id: file.id }} className="font-mono text-xs" title={file.path}>
                  {directory.path && file.path.startsWith(`${directory.path}/`) ? file.path.slice(directory.path.length + 1) : file.path}
                </NodeLink>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-subtle">
                  {formatCompact(file.lines)}
                  {file.linesEstimated ? "~" : ""}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
    </div>
  );
}
