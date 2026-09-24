// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "./icon-button";
import { Panel } from "./panel";

afterEach(() => cleanup());

/** A toolbar toggle that opens a closable panel, like the statistics panel. */
function Harness({ onUnmountWithFocus }: { onUnmountWithFocus?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        Statistics
      </button>
      <button type="button">Elsewhere</button>
      {open ? (
        <Panel title="acme/platform" eyebrow="Repository statistics" onClose={() => setOpen(false)} onUnmountWithFocus={onUnmountWithFocus}>
          <button type="button">Inside</button>
        </Panel>
      ) : null}
    </>
  );
}

describe("Panel", () => {
  it("renders the title as a heading that names the landmark", () => {
    render(
      <Panel title="Contributors · 12">
        <p>Body</p>
      </Panel>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Contributors · 12" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("complementary", { name: "Contributors · 12" })).toBeInTheDocument();
  });

  it("keeps an explicit landmark label", () => {
    render(
      <Panel title="auth.ts" aria-label="Selection details">
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole("complementary", { name: "Selection details" })).not.toHaveAttribute("aria-labelledby");
  });

  it("returns focus to the control that opened it when closed from inside", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Statistics" }));
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Statistics" })).toHaveFocus();
  });

  it("leaves focus alone when it is outside the panel as it closes", () => {
    const Page = ({ open }: { open: boolean }) => (
      <>
        <button type="button">Opener</button>
        <button type="button">Elsewhere</button>
        {open ? <Panel title="acme/platform">Body</Panel> : null}
      </>
    );
    const { rerender } = render(<Page open={false} />);
    screen.getByRole("button", { name: "Opener" }).focus();
    rerender(<Page open />);
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    rerender(<Page open={false} />);
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("lets the owner decide where focus goes instead", async () => {
    const user = userEvent.setup();
    const onUnmountWithFocus = vi.fn();
    render(<Harness onUnmountWithFocus={onUnmountWithFocus} />);
    await user.click(screen.getByRole("button", { name: "Statistics" }));
    screen.getByRole("button", { name: "Inside" }).focus();
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onUnmountWithFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Statistics" })).not.toHaveFocus();
  });
});

describe("IconButton tooltips", () => {
  it("aligns the tooltip to the button's end edge on request", () => {
    render(
      <>
        <IconButton label="Centred" icon={<span />} />
        <IconButton label="Keyboard shortcuts" shortcut="?" tooltipAlign="end" icon={<span />} />
      </>,
    );
    const tooltip = (name: string) => screen.getByRole("button", { name }).nextElementSibling;
    expect(tooltip("Centred")).toHaveClass("left-1/2", "-translate-x-1/2");
    expect(tooltip("Keyboard shortcuts (?)")).toHaveClass("right-0");
    expect(tooltip("Keyboard shortcuts (?)")).not.toHaveClass("left-1/2");
    expect(tooltip("Keyboard shortcuts (?)")).toHaveTextContent("Keyboard shortcuts?");
  });
});
