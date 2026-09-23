"use client";

import type { MouseEvent, ReactNode } from "react";
import { REPOSITORY_INPUT_ID } from "./constants";

export interface FocusInputLinkProps {
  children: ReactNode;
  className?: string;
  /** Id of the input to focus (defaults to the landing page's repository input). */
  inputId?: string;
}

/**
 * A link to the repository input that scrolls it into view and focuses it, so
 * the user can start typing straight away. Without JavaScript it degrades to a
 * plain in-page anchor.
 */
export function FocusInputLink({
  children,
  className,
  inputId = REPOSITORY_INPUT_ID,
}: FocusInputLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    input.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    input.focus({ preventScroll: true });
  };

  return (
    <a href={`#${inputId}`} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
