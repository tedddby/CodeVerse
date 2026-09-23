// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@/config/site";
import { GitHubMark } from "./github-mark";
import { Logo } from "./logo";
import { LogoMark } from "./logo-mark";

describe("LogoMark", () => {
  it("is an image named by its title when a title is given", () => {
    render(<LogoMark title="CodeVerse" />);
    const mark = screen.getByRole("img", { name: "CodeVerse" });
    expect(mark.tagName.toLowerCase()).toBe("svg");
    expect(mark.querySelector("title")?.textContent).toBe("CodeVerse");
    expect(mark).not.toHaveAttribute("aria-hidden");
  });

  it("is decorative and hidden from assistive technology without a title", () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.querySelector("title")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("uses the requested knockout color to separate the orbit from the tower", () => {
    const { container } = render(<LogoMark knockout="#0b111c" />);
    const knockoutStrokes = [...container.querySelectorAll("[stroke]")].filter(
      (element) => element.getAttribute("stroke") === "#0b111c",
    );
    expect(knockoutStrokes.length).toBeGreaterThan(0);
  });

  it("passes through sizing and presentation props", () => {
    const { container } = render(<LogoMark className="size-14" width={56} height={56} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "56");
    expect(svg).toHaveClass("size-14");
    expect(svg).toHaveAttribute("viewBox", "0 0 32 32");
  });
});

describe("Logo", () => {
  it("renders the product name as real text next to a decorative mark", () => {
    const { container } = render(<Logo />);
    expect(screen.getByText(siteConfig.name)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The lockup's accessible text is exactly the product name (no duplicated title).
    expect(container.textContent).toBe(siteConfig.name);
  });

  it("gives a link wrapping it the product name as accessible name", () => {
    render(
      <a href="#top">
        <Logo />
      </a>,
    );
    expect(screen.getByRole("link", { name: siteConfig.name })).toHaveAttribute("href", "#top");
  });
});

describe("GitHubMark", () => {
  it("is always decorative", () => {
    const { container } = render(<GitHubMark className="size-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveClass("size-4");
  });
});
