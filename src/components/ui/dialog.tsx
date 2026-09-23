"use client";

import { X } from "lucide-react";
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils/cn";
import { useFocusTrap } from "./use-focus-trap";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Visually hide the title (it still labels the dialog for screen readers). */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Element to focus when the dialog opens (defaults to the first focusable). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** "center" modal or "top" command-palette placement. */
  placement?: "center" | "top";
}

/**
 * Accessible modal dialog: backdrop click and Escape close it, focus is trapped
 * inside and restored on close. Renders nothing when closed.
 */
export function Dialog({
  open,
  onClose,
  title,
  hideTitle,
  description,
  children,
  className,
  initialFocusRef,
  placement = "center",
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, initialFocusRef);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-void/60 px-4 backdrop-blur-[2px] animate-fade-in",
        placement === "center" ? "items-center" : "items-start pt-[12vh]",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn("glass relative w-full max-w-lg rounded-2xl shadow-2xl animate-slide-up", className)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className={cn("flex items-start justify-between gap-4 px-5 pt-4", hideTitle && "sr-only")}>
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {!hideTitle ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-panel-raised hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
