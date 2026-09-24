import { Check, Copy, ExternalLink, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { RefObject } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Badge, LanguageDot } from "@/components/ui/primitives";
import type { FileNode } from "@/graph/model/types";
import { getLanguage } from "@/lib/languages/registry";
import { formatBytes, formatInteger } from "@/lib/utils/format";
import { escapeHiddenCharacters } from "./hidden-characters";
import { revealHiddenCharacters } from "./revealed-text";
import type { CopyState } from "./use-copy-to-clipboard";

export interface CodeViewerHeaderProps {
  titleId: string;
  file: FileNode;
  /** Line count of the loaded content (falls back to the graph's count while loading). */
  lineCount: number;
  size: number;
  commitSha: string;
  githubUrl: string | null;
  canCopy: boolean;
  copyState: CopyState;
  onCopy: () => void;
  outline: { available: boolean; open: boolean; toggle: () => void };
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

export function CodeViewerHeader({
  titleId,
  file,
  lineCount,
  size,
  commitSha,
  githubUrl,
  canCopy,
  copyState,
  onCopy,
  outline,
  onClose,
  closeButtonRef,
}: CodeViewerHeaderProps) {
  const slash = file.path.lastIndexOf("/");
  const directory = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const language = getLanguage(file.language);

  return (
    <div className="border-line/80 flex items-start gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">Source</p>
        <h2
          id={titleId}
          className="mt-0.5 flex min-w-0 items-baseline font-mono text-sm"
          title={escapeHiddenCharacters(file.path)}
        >
          {directory ? (
            <span className="text-ink-subtle min-w-0 truncate">
              {revealHiddenCharacters(directory)}
            </span>
          ) : null}
          <span className="text-ink shrink-0 font-semibold">
            {revealHiddenCharacters(file.name)}
          </span>
        </h2>
        <div className="text-ink-subtle mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-ink-muted flex items-center gap-1.5">
            <LanguageDot language={file.language} />
            {language.id === "unknown" ? "Plain text" : language.name}
          </span>
          <span className="font-mono tabular-nums">{formatInteger(lineCount)} lines</span>
          <span className="font-mono tabular-nums">{formatBytes(size)}</span>
          <span className="font-mono" title={`Commit ${commitSha}`}>
            @{commitSha.slice(0, 7)}
          </span>
          {file.isGenerated ? <Badge tone="warn">Generated</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {outline.available ? (
          <IconButton
            label={outline.open ? "Hide outline" : "Show outline"}
            pressed={outline.open}
            icon={outline.open ? <PanelLeftClose /> : <PanelLeftOpen />}
            onClick={outline.toggle}
            className="hidden lg:inline-flex"
          />
        ) : null}
        <IconButton
          label={
            copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy file contents"
          }
          icon={copyState === "copied" ? <Check className="text-ok" /> : <Copy />}
          onClick={onCopy}
          disabled={!canCopy}
        />
        {githubUrl ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open on GitHub (opens in a new tab)"
            title="Open on GitHub"
            className="text-ink-muted hover:border-line-strong hover:bg-panel-raised hover:text-ink inline-flex size-9 items-center justify-center rounded-lg border border-transparent transition-colors"
          >
            <ExternalLink aria-hidden="true" className="size-[18px]" />
          </a>
        ) : null}
        <IconButton
          ref={closeButtonRef}
          label="Close source viewer"
          shortcut="Esc"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {copyState === "copied"
          ? "File contents copied to the clipboard."
          : copyState === "failed"
            ? "Copy failed."
            : ""}
      </p>
    </div>
  );
}
