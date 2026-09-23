"use client";

import { useCallback, useSyncExternalStore } from "react";

function supportsMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * Live `matchMedia` subscription. Returns `serverValue` during SSR/hydration
 * and in environments without matchMedia.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supportsMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => (supportsMatchMedia() ? window.matchMedia(query).matches : serverValue), [query, serverValue]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Tailwind's `md` breakpoint: below it, panels become bottom sheets. */
export const NARROW_VIEWPORT_QUERY = "(max-width: 767.98px)";

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
