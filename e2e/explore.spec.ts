import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_OWNER, FIXTURE_REPO, mockAnalysisApi } from "./support/mock-api";

/** Software-rendered WebGL (SwiftShader) makes the world slower to appear than on real GPUs. */
const WORLD_TIMEOUT = { timeout: 45_000 };

const repoLink = (page: Page) =>
  page.getByRole("link", { name: new RegExp(`${FIXTURE_OWNER}/${FIXTURE_REPO}`, "i") }).first();

/** Waits until client components are interactive, so typed input is not reset by hydration. */
async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/**
 * Core user journey:
 * open homepage → enter repository → analyze → explorer loads → select file → source viewer opens.
 */
test.describe("explore a repository", () => {
  test.beforeEach(async ({ page }) => {
    await mockAnalysisApi(page);
  });

  test("homepage → explorer → select file → view source", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: /explore any codebase as a 3d universe/i }),
    ).toBeVisible();

    const input = page.getByRole("textbox", { name: /repository/i }).first();
    await input.fill(`https://github.com/${FIXTURE_OWNER}/${FIXTURE_REPO}`);
    await page
      .getByRole("button", { name: /^explore/i })
      .first()
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/explore/${FIXTURE_OWNER}/${FIXTURE_REPO}`),
      WORLD_TIMEOUT,
    );

    // The explorer shell appears once the analysis stream completes and the world is laid out.
    await expect(repoLink(page)).toBeVisible(WORLD_TIMEOUT);

    // Select a file through global search (keyboard-first flow).
    await page
      .locator("body")
      .click({ position: { x: 5, y: 5 } })
      .catch(() => undefined);
    await page.keyboard.press("/");
    const search = page.getByRole("dialog", { name: /search repository/i });
    await expect(search).toBeVisible();
    await search.getByRole("combobox").or(search.getByRole("textbox")).first().fill("auth.ts");
    await page.keyboard.press("Enter");

    // The selection panel shows the file's details.
    const details = page.getByRole("complementary").filter({ hasText: "auth.ts" }).first();
    await expect(details).toBeVisible();
    await expect(details).toContainText(/TypeScript/);

    // Open the lazy-loaded source viewer.
    await details.getByRole("button", { name: "View source", exact: true }).click();
    await expect(page.getByText("CodeVerse E2E fixture")).toBeVisible();
  });

  test("shared deep link opens the explorer directly", async ({ page }) => {
    await page.goto(`/explore/${FIXTURE_OWNER}/${FIXTURE_REPO}?mode=dependencies`);
    await expect(repoLink(page)).toBeVisible(WORLD_TIMEOUT);
    await expect(
      page.getByRole("button", { name: /dependencies/i, pressed: true }).first(),
    ).toBeVisible();
  });

  test("the 3D canvas fills the explorer viewport after the entry transition", async ({ page }) => {
    await page.goto(`/explore/${FIXTURE_OWNER}/${FIXTURE_REPO}`);
    await expect(repoLink(page)).toBeVisible(WORLD_TIMEOUT);
    // Regression: the canvas kept the size it had during the zoomed loading
    // transition (94% of the viewport), leaving a dead strip.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const container = document.querySelector<HTMLElement>("[data-explorer-canvas]");
            const canvas = container?.querySelector("canvas");
            if (!container || !canvas) return null;
            return {
              width: Math.abs(canvas.clientWidth - container.clientWidth),
              height: Math.abs(canvas.clientHeight - container.clientHeight),
            };
          }),
        { timeout: 15_000 },
      )
      .toEqual({ width: 0, height: 0 });
  });

  test("glass panels keep their blur and focus rings can be inset", async ({ page }) => {
    await gotoHydrated(page, `/explore/${FIXTURE_OWNER}/${FIXTURE_REPO}`);
    await expect(repoLink(page)).toBeVisible(WORLD_TIMEOUT);

    // The production minifier once kept only `-webkit-backdrop-filter`, which Chromium ignores.
    const glass = page.locator(".glass").first();
    await expect
      .poll(() => glass.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toContain("blur");

    // The global ring lives in the base layer, so the minimap's inset offset utility wins
    // and the ring is not clipped by the minimap's rounded, overflow-hidden frame.
    const minimap = page.getByRole("application", { name: /repository map/i });
    await expect(minimap).toBeVisible();
    for (let step = 0; step < 60; step++) {
      if (await minimap.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(minimap).toBeFocused();
    const ring = await minimap.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, offset: style.outlineOffset };
    });
    expect(ring).toEqual({ style: "solid", offset: "-2px" });
  });

  test("invalid input shows an inline validation error", async ({ page }) => {
    await gotoHydrated(page, "/");
    const input = page.getByRole("textbox", { name: /repository/i }).first();
    await input.fill("https://gitlab.com/foo/bar");
    await page
      .getByRole("button", { name: /^explore/i })
      .first()
      .click();
    await expect(page.getByText(/doesn't look like a github repository/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("error handling", () => {
  test("repository not found shows a helpful message", async ({ page }) => {
    await mockAnalysisApi(page, {
      analysisError: {
        code: "NOT_FOUND",
        title: "Repository not found.",
        message: "This repository may be private or the URL may be incorrect.",
      },
    });
    await page.goto("/explore/some-owner/does-not-exist");
    await expect(page.getByText("Repository not found.")).toBeVisible();
    await expect(page.getByText(/may be private or the URL may be incorrect/i)).toBeVisible();
  });

  test("rate limit explains how to continue", async ({ page }) => {
    await mockAnalysisApi(page, {
      analysisError: {
        code: "RATE_LIMITED",
        title: "GitHub API rate limit reached.",
        message:
          "Add a GitHub token to continue with higher limits, or try again when the limit resets.",
        retryAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    });
    await page.goto("/explore/some-owner/some-repo");
    await expect(page.getByText("GitHub API rate limit reached.")).toBeVisible();
    await expect(page.getByText(/github token/i).first()).toBeVisible();
  });
});
