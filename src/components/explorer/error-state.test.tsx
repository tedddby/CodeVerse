// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_COPY } from "@/analysis/protocol";
import { PARSE_ERROR_MESSAGES } from "@/lib/validation/repository-url";
import { describeRetryAt, ErrorState } from "./error-state";
import { explorerHrefForInput } from "./repository-jump-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ErrorState", () => {
  it("explains a missing repository with the canonical copy and recovery actions", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        error={{ code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND }}
        owner="acme"
        repo="nope"
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "Repository not found." }),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText("This repository may be private or the URL may be incorrect."),
    ).toBeInTheDocument();
    expect(screen.getByText("acme/nope")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Repository not found." })).toHaveFocus();
    // Missing repositories get no rate-limit hints.
    expect(screen.queryByText(/GITHUB_TOKEN/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Back home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "facebook/react" })).toHaveAttribute(
      "href",
      "/explore/facebook/react",
    );
  });

  it("uses server-provided specifics over the canonical copy", () => {
    render(
      <ErrorState
        error={{
          code: "REF_NOT_FOUND",
          title: "Branch “nightly” not found.",
          message: "Pick an existing branch.",
        }}
        owner="acme"
        repo="app"
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Branch “nightly” not found." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick an existing branch.")).toBeInTheDocument();
  });

  it("suggests a GitHub token and shows the reset time when rate limited", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-23T12:00:00.000Z") });
    render(
      <ErrorState
        error={{
          code: "RATE_LIMITED",
          ...ERROR_COPY.RATE_LIMITED,
          retryAt: "2026-09-23T12:12:00.000Z",
        }}
        owner="facebook"
        repo="react"
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "GitHub API rate limit reached." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Add a GitHub token/)).toBeInTheDocument();
    expect(screen.getByText(/GITHUB_TOKEN/)).toBeInTheDocument();
    expect(screen.getByText(/Resets at .* \(in 12 minutes\)\./)).toBeInTheDocument();
    // The current repository is not offered as an example.
    expect(screen.queryByRole("link", { name: "facebook/react" })).not.toBeInTheDocument();
  });

  it("validates the inline repository input before navigating", async () => {
    const user = userEvent.setup();
    render(
      <ErrorState
        error={{ code: "NOT_FOUND", ...ERROR_COPY.NOT_FOUND }}
        owner="acme"
        repo="nope"
        onRetry={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Try another repository" });

    await user.type(input, "https://gitlab.com/a/b");
    await user.click(screen.getByRole("button", { name: "Explore repository" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(PARSE_ERROR_MESSAGES["not-github"])).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    await user.clear(input);
    await user.type(input, "https://github.com/vercel/next.js/tree/canary/packages{Enter}");
    expect(push).toHaveBeenCalledWith("/explore/vercel/next.js?ref=canary");
  });
});

describe("helpers", () => {
  it("describes retry times relative to now", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    expect(describeRetryAt(undefined, now)).toBeNull();
    expect(describeRetryAt("garbage", now)).toBeNull();
    expect(describeRetryAt("2026-09-23T11:00:00.000Z", now)).toMatch(/try again now/);
    expect(describeRetryAt("2026-09-23T14:00:00.000Z", now)).toMatch(/\(in 2 hours\)\.$/);
  });

  it("maps repository input to explorer URLs", () => {
    expect(explorerHrefForInput("facebook/react")).toEqual({ href: "/explore/facebook/react" });
    expect(explorerHrefForInput("")).toEqual({ error: PARSE_ERROR_MESSAGES.empty });
  });
});
