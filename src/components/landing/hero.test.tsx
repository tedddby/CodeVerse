// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@/config/site";
import { PARSE_ERROR_MESSAGES } from "@/lib/validation/repository-url";
import { REPOSITORY_INPUT_ID } from "./constants";
import { Hero } from "./hero";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

function setup() {
  const user = userEvent.setup();
  render(<Hero />);
  const input = screen.getByRole("textbox", { name: /github repository/i });
  const submit = screen.getByRole("button", { name: /^explore/i });
  return { user, input, submit };
}

beforeEach(() => {
  push.mockReset();
  // jsdom has no layout engine, so scrollIntoView is missing.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Hero", () => {
  it("renders the headline, the promise and a labelled repository input", () => {
    setup();
    expect(
      screen.getByRole("heading", { level: 1, name: siteConfig.headline }),
    ).toBeInTheDocument();
    expect(screen.getByText(siteConfig.description)).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: /github repository/i });
    expect(input).toHaveAttribute("id", REPOSITORY_INPUT_ID);
    expect(input).toHaveAttribute("placeholder", "https://github.com/facebook/react");
  });

  it("keeps the submit button as the first button named 'Explore…' (the E2E contract)", () => {
    const { submit } = setup();
    const [firstExploreButton] = screen.getAllByRole("button", { name: /^explore/i });
    expect(firstExploreButton).toBe(submit);
    expect(submit).toHaveAttribute("type", "submit");
  });
});

describe("repository form validation", () => {
  it("explains an empty submission inline and does not navigate", async () => {
    const { user, input, submit } = setup();
    await user.click(submit);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(PARSE_ERROR_MESSAGES.empty);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(input).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["https://gitlab.com/foo/bar", PARSE_ERROR_MESSAGES["not-github"]],
    ["facebook", PARSE_ERROR_MESSAGES["not-github"]],
    ["https://github.com/facebook", PARSE_ERROR_MESSAGES["missing-repo"]],
    ["https://github.com/-bad-/repo", PARSE_ERROR_MESSAGES["invalid-owner"]],
    ["https://github.com/settings/profile", PARSE_ERROR_MESSAGES["invalid-owner"]],
  ])("rejects %s with the parser's message", async (value, message) => {
    const { user, input, submit } = setup();
    await user.type(input, value);
    await user.click(submit);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(push).not.toHaveBeenCalled();
  });

  it("clears the error as soon as the input is edited", async () => {
    const { user, input, submit } = setup();
    await user.type(input, "not a repo");
    await user.click(submit);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(input, "x");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    // The hint stays associated with the input.
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("submits with the Enter key", async () => {
    const { user, input } = setup();
    await user.type(input, "facebook/react{Enter}");
    expect(push).toHaveBeenCalledWith("/explore/facebook/react");
  });
});

describe("repository form navigation", () => {
  it.each([
    ["facebook/react", "/explore/facebook/react"],
    ["  https://github.com/vercel/next.js  ", "/explore/vercel/next.js"],
    ["git@github.com:torvalds/linux.git", "/explore/torvalds/linux"],
    [
      "https://github.com/vercel/next.js/tree/canary/packages/next",
      "/explore/vercel/next.js?ref=canary",
    ],
    [
      "https://github.com/facebook/react/blob/v18.2.0/README.md",
      "/explore/facebook/react?ref=v18.2.0",
    ],
  ])("navigates %s to %s", async (value, href) => {
    const { user, input, submit } = setup();
    await user.type(input, value);
    await user.click(submit);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(href);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("hero links", () => {
  it("links every example chip to its explorer page", () => {
    setup();
    const list = screen.getByRole("list", { name: /example repositories/i });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(siteConfig.exampleRepositories.length);
    siteConfig.exampleRepositories.forEach(({ owner, repo }, index) => {
      expect(links[index]).toHaveAttribute("href", `/explore/${owner}/${repo}`);
      expect(links[index]).toHaveTextContent(`${owner}/${repo}`);
    });
  });

  it("focuses the repository input from the primary call to action", async () => {
    const { user, input } = setup();
    const cta = screen.getByRole("link", { name: "Explore a repository" });
    expect(cta).toHaveAttribute("href", `#${REPOSITORY_INPUT_ID}`);
    await user.click(cta);
    expect(input).toHaveFocus();
  });

  it("opens the project repository in a new tab from the secondary call to action", () => {
    setup();
    const link = screen.getByRole("link", { name: /view on github/i });
    expect(link).toHaveAttribute("href", siteConfig.repositoryUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
