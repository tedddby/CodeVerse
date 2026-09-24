"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Whether `element` is rendered, i.e. neither it nor an ancestor up to
 * `container` is `display: none`, and it is not `visibility: hidden`. The
 * browser skips such elements when tabbing, so the trap must too. Uses
 * `checkVisibility()` where available; otherwise (older engines, jsdom) reads
 * computed styles, which is equivalent for these two properties.
 */
function isRendered(element: HTMLElement, container: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true });
  }
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  // `visibility` is inherited, so the element's own value accounts for its ancestors.
  if (view.getComputedStyle(element).visibility === "hidden") return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || view.getComputedStyle(node).display === "none") return false;
    if (node === container) break;
  }
  return true;
}

/** Whether `node` comes before `reference` in document order (ancestors included). */
function precedes(node: Node, reference: Node): boolean {
  return (reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

/** Whether `node` comes after `reference` in document order (descendants included). */
function follows(node: Node, reference: Node): boolean {
  return (reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * Keeps keyboard focus inside `containerRef` while `active`, focuses the first
 * focusable element (or `initialFocusRef`) on activation and restores focus to
 * the previously focused element on deactivation.
 *
 * Tab wraps between the first and last rendered focusable elements, also when
 * focus sits outside them: on the container itself (focused when it holds
 * nothing focusable), or on a programmatically focused element such as a title
 * before the first control.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const candidates = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) =>
          !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
      );
    // Visibility is only checked from each end until a rendered element is found (cheap for long lists).
    const firstRendered = (items: readonly HTMLElement[]) =>
      items.find((element) => isRendered(element, container));
    const lastRendered = (items: readonly HTMLElement[]) => {
      for (let position = items.length - 1; position >= 0; position -= 1) {
        const element = items[position];
        if (element && isRendered(element, container)) return element;
      }
      return undefined;
    };

    const initial = initialFocusRef?.current ?? firstRendered(candidates()) ?? container;
    if (initial === container && !container.hasAttribute("tabindex"))
      container.setAttribute("tabindex", "-1");
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = candidates();
      const first = firstRendered(items);
      const last = lastRendered(items);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (!current) return;
      if (event.shiftKey && (current === first || precedes(current, first))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || follows(current, last))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused))
        previouslyFocused.focus({ preventScroll: true });
    };
  }, [active, containerRef, initialFocusRef]);
}
