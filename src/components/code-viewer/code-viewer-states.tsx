import {
  Binary,
  Clock,
  ExternalLink,
  FileX,
  HardDrive,
  RotateCcw,
  ServerCrash,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { SourceViewerError, SourceViewerErrorCode } from "./source-cache";

/** Deterministic widths so the skeleton looks like code without randomness. */
const SKELETON_WIDTHS = [
  38, 62, 54, 0, 71, 46, 83, 58, 0, 34, 66, 77, 49, 0, 57, 42, 69, 31, 52, 0, 64, 45,
];

/** Code-shaped loading placeholder (no spinner). */
export function CodeSkeleton({ animate }: { animate: boolean }) {
  return (
    <div role="status" aria-label="Loading source" className="flex-1 overflow-hidden px-4 py-3">
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex h-5 items-center gap-4">
          <span className="bg-line/70 h-2 w-6 shrink-0 rounded-sm" />
          {width > 0 ? (
            <span
              className={cn("bg-line-strong/60 h-2 rounded-sm", animate && "animate-pulse-soft")}
              style={{
                width: `${width}%`,
                marginLeft: `${(index % 4) * 1.5}rem`,
                animationDelay: `${index * 60}ms`,
              }}
            />
          ) : null}
        </div>
      ))}
      <span className="sr-only">Loading source…</span>
    </div>
  );
}

const ERROR_ICONS: Record<SourceViewerErrorCode, LucideIcon> = {
  INVALID_REQUEST: TriangleAlert,
  NOT_FOUND: FileX,
  BINARY: Binary,
  TOO_LARGE: HardDrive,
  RATE_LIMITED: Clock,
  UPSTREAM_ERROR: ServerCrash,
  INTERNAL: TriangleAlert,
  NETWORK: WifiOff,
  INVALID_RESPONSE: TriangleAlert,
};

export interface SourceMessageProps {
  icon: LucideIcon;
  title: string;
  message: ReactNode;
  tone?: "neutral" | "warn";
  actions?: ReactNode;
}

/** Centered message used for errors and informational states. */
export function SourceMessage({
  icon: Icon,
  title,
  message,
  tone = "neutral",
  actions,
}: SourceMessageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <span
        className={cn(
          "mb-4 flex size-11 items-center justify-center rounded-xl border",
          tone === "warn"
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-line-strong bg-panel-raised text-ink-muted",
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h3 className="text-ink text-sm font-semibold">{title}</h3>
      <p className="text-ink-muted mt-1.5 max-w-sm text-sm">{message}</p>
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export interface SourceErrorStateProps {
  error: SourceViewerError;
  githubUrl: string | null;
  onRetry: () => void;
}

export function SourceErrorState({ error, githubUrl, onRetry }: SourceErrorStateProps) {
  const informational = error.code === "BINARY" || error.code === "TOO_LARGE";
  return (
    <div role={informational ? "status" : "alert"} className="flex flex-1 flex-col">
      <SourceMessage
        icon={ERROR_ICONS[error.code]}
        title={error.title}
        message={error.message}
        tone={informational ? "neutral" : "warn"}
        actions={
          <>
            {error.retryable ? (
              <Button size="sm" onClick={onRetry}>
                <RotateCcw aria-hidden="true" className="size-3.5" />
                Try again
              </Button>
            ) : null}
            {githubUrl ? (
              <ButtonLink
                href={githubUrl}
                external
                size="sm"
                variant={error.retryable ? "ghost" : "secondary"}
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                Open on GitHub
              </ButtonLink>
            ) : null}
          </>
        }
      />
    </div>
  );
}
