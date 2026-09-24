"use client";

import { X } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils/cn";

export interface PanelProps {
  /** Panel heading (an h2); names the landmark unless `aria-label` is given. */
  title: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  onClose?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Landmark element; panels are complementary content by default. */
  as?: "aside" | "section" | "div";
  "aria-label"?: string;
  /** The title heading; it is focusable from script (tabIndex -1), e.g. after the panel's content was replaced. */
  titleRef?: Ref<HTMLHeadingElement>;
  /**
   * Called when the panel unmounts while it holds keyboard focus, before its
   * DOM is removed. By default focus returns to the element that was focused
   * when the panel opened, so closing it never drops focus to <body>.
   */
  onUnmountWithFocus?: () => void;
}

function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Floating glass panel with a header, used for explorer side panels. */
export function Panel({
  title,
  eyebrow,
  onClose,
  actions,
  children,
  className,
  bodyClassName,
  as: Component = "aside",
  "aria-label": ariaLabel,
  titleRef,
  onUnmountWithFocus,
}: PanelProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  // A callback ref: the landmark element varies with `as`.
  const setRoot = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
  }, []);
  const unmountHandler = useRef(onUnmountWithFocus);
  useLayoutEffect(() => {
    unmountHandler.current = onUnmountWithFocus;
  });

  // A layout-effect cleanup runs before React removes the panel's DOM, while
  // the focused control (e.g. the close button) is still inside it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const opener = focusedElement();
    return () => {
      if (!root?.contains(document.activeElement)) return;
      const handler = unmountHandler.current;
      if (handler) handler();
      else if (opener?.isConnected && !root.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <Component
      ref={setRoot}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel || Component === "div" ? undefined : titleId}
      className={cn(
        "glass flex max-h-full flex-col overflow-hidden rounded-2xl shadow-2xl",
        className,
      )}
    >
      <header className="border-line/80 flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-ink-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h2
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="text-ink truncate text-sm font-semibold"
          >
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="text-ink-subtle hover:bg-panel-raised hover:text-ink rounded-md p-1.5 transition-colors"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", bodyClassName)}>
        {children}
      </div>
    </Component>
  );
}
