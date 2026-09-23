/** Media-query probes used by the landing demo. Safe to call during SSR (return false). */

/** True when the primary pointer is touch-like (drags would fight page scrolling). */
export function prefersCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
