import { expect, test } from "@playwright/test";
import { FIXTURE_OWNER, FIXTURE_REPO, mockAnalysisApi } from "./support/mock-api";

/**
 * Visual QA captures (opt-in): SCREENSHOTS=1 pnpm test:e2e screenshots
 * Writes PNGs to test-results/screenshots/ using the demo fixture repository.
 */
test.describe("visual captures", () => {
  test.skip(process.env.SCREENSHOTS !== "1", "set SCREENSHOTS=1 to capture screenshots");

  const out = (name: string) => `test-results/screenshots/${name}.png`;

  test("landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: out("landing-hero") });
    await page.screenshot({ path: out("landing-full"), fullPage: true });
  });

  test("explorer modes", async ({ page }) => {
    await mockAnalysisApi(page);
    await page.goto(`/explore/${FIXTURE_OWNER}/${FIXTURE_REPO}`);
    await expect(page.getByRole("link", { name: new RegExp(`${FIXTURE_OWNER}/${FIXTURE_REPO}`, "i") }).first()).toBeVisible({ timeout: 45_000 });
    // Let the intro camera animation and building rise settle.
    await page.waitForTimeout(3500);
    await page.screenshot({ path: out("explorer-architecture") });

    for (const [key, name] of [
      ["2", "dependencies"],
      ["3", "activity"],
      ["4", "contributors"],
      ["5", "complexity"],
    ] as const) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
      await page.screenshot({ path: out(`explorer-${name}`) });
    }

    await page.keyboard.press("1");
    await page.keyboard.press("/");
    await page.keyboard.type("auth.ts");
    await page.waitForTimeout(300);
    await page.screenshot({ path: out("explorer-search") });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1800);
    await page.screenshot({ path: out("explorer-selection") });

    await page.keyboard.press("v");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out("explorer-source") });
    await page.keyboard.press("Escape");

    await page.keyboard.press("i");
    await page.waitForTimeout(500);
    await page.screenshot({ path: out("explorer-analytics") });
    await page.keyboard.press("i");

    await page.keyboard.press("t");
    await page.waitForTimeout(500);
    await page.screenshot({ path: out("explorer-timeline") });
  });
});
