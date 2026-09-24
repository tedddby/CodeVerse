// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "./use-focus-trap";

afterEach(() => cleanup());

function Trap({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);
  return (
    <div ref={containerRef} data-testid="trap">
      {children}
    </div>
  );
}

/** Dispatches Tab on the focused element; returns true when the trap took it over (default prevented). */
function pressTab(shift = false): boolean {
  const target = document.activeElement ?? document.body;
  return !fireEvent.keyDown(target, { key: "Tab", shiftKey: shift });
}

const button = (name: string) => screen.getByRole("button", { name, hidden: true });

describe("useFocusTrap", () => {
  it("skips focusables that are not rendered when focusing and wrapping", () => {
    render(
      <Trap>
        <div style={{ display: "none" }}>
          <button type="button">Collapsed</button>
        </div>
        <button type="button" hidden>
          Hidden attribute
        </button>
        <button type="button">First</button>
        <button type="button">Middle</button>
        <button type="button">Last</button>
        <span style={{ visibility: "hidden" }}>
          <button type="button">Invisible</button>
        </span>
        <div hidden>
          <button type="button">Inside hidden</button>
        </div>
      </Trap>,
    );
    expect(button("First")).toHaveFocus();

    // Middle elements are left to the browser.
    button("Middle").focus();
    expect(pressTab()).toBe(false);
    expect(pressTab(true)).toBe(false);

    button("Last").focus();
    expect(pressTab()).toBe(true);
    expect(button("First")).toHaveFocus();
    expect(pressTab(true)).toBe(true);
    expect(button("Last")).toHaveFocus();
  });

  it("uses checkVisibility() when the browser has it", () => {
    const checkVisibility = vi.fn(function (this: HTMLElement) {
      return this.textContent !== "Offscreen";
    });
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      value: checkVisibility,
    });
    try {
      render(
        <Trap>
          <button type="button">Offscreen</button>
          <button type="button">Visible</button>
        </Trap>,
      );
      expect(button("Visible")).toHaveFocus();
      expect(checkVisibility).toHaveBeenCalledWith({ visibilityProperty: true });
      expect(pressTab(true)).toBe(true);
      expect(button("Visible")).toHaveFocus();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
    }
  });

  it("wraps Shift+Tab to the last control when the container itself has focus", () => {
    render(
      <Trap>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Trap>,
    );
    const container = screen.getByTestId("trap");
    container.tabIndex = -1;
    // E.g. a click on the dialog's padding focuses the container.
    container.focus();
    expect(container).toHaveFocus();
    expect(pressTab(true)).toBe(true);
    expect(button("Last")).toHaveFocus();

    // Tab from the container moves into it natively (the first control follows it).
    container.focus();
    expect(pressTab()).toBe(false);
  });

  it("wraps from a focused element before the first control or after the last", () => {
    render(
      <Trap>
        <h2 tabIndex={-1}>Title</h2>
        <button type="button">First</button>
        <button type="button">Last</button>
        <p tabIndex={-1}>Footnote</p>
      </Trap>,
    );
    screen.getByRole("heading", { name: "Title" }).focus();
    expect(pressTab(true)).toBe(true);
    expect(button("Last")).toHaveFocus();

    screen.getByText("Footnote").focus();
    expect(pressTab()).toBe(true);
    expect(button("First")).toHaveFocus();
  });

  it("keeps focus on the container when nothing inside is rendered", () => {
    render(
      <Trap>
        <div hidden>
          <button type="button">Hidden</button>
        </div>
        <p>Only text</p>
      </Trap>,
    );
    const container = screen.getByTestId("trap");
    expect(container).toHaveFocus();
    expect(container).toHaveAttribute("tabindex", "-1");
    expect(pressTab()).toBe(true);
    expect(pressTab(true)).toBe(true);
    expect(container).toHaveFocus();
  });

  it("restores focus to the previously focused element when released", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(
      <Trap>
        <button type="button">Inside</button>
      </Trap>,
    );
    expect(button("Inside")).toHaveFocus();
    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
