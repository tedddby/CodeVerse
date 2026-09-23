"use client";

import { MousePointerClick, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One-time onboarding hint ("Drag to orbit · Scroll to zoom · …"). Dismissal
 * is remembered in localStorage; storage failures (private mode, disabled
 * storage) simply mean the hint may show again.
 */

export const HINT_STORAGE_KEY = "codeverse:explorer-hint-dismissed:v1";

const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Session fallback when storage is unavailable, so dismissing still works until reload. */
let dismissedInMemory = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === HINT_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function dismissExplorerHint(): void {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable: the in-memory flag hides the hint for this session.
  }
  for (const listener of listeners) listener();
}

function useHintDismissed(): boolean {
  const getSnapshot = useCallback(() => dismissedInMemory || readDismissed(), []);
  // Hidden during SSR/hydration; revealed on the client if never dismissed.
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export function FirstVisitHint({ className }: { className?: string }) {
  const dismissed = useHintDismissed();
  if (dismissed) return null;
  return (
    <div
      role="note"
      aria-label="How to navigate"
      className={cn(
        "glass pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl py-2 pl-3 pr-1.5 text-xs text-ink-muted shadow-2xl animate-slide-up [animation-delay:900ms]",
        className,
      )}
    >
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0 text-signal" />
      <p className="min-w-0">
        <span className="max-md:hidden">Drag to orbit · Scroll to zoom · Click a building · Press </span>
        <span className="md:hidden">Drag to orbit · Pinch to zoom · Tap a building · Press </span>
        <kbd className="kbd">?</kbd> for shortcuts
      </p>
      <button
        type="button"
        onClick={dismissExplorerHint}
        aria-label="Dismiss navigation hint"
        className="shrink-0 rounded-md p-1 text-ink-subtle transition-colors hover:bg-panel-raised hover:text-ink"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
