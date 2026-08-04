import { expect, test } from "@playwright/test";
import { LAZY_INCREMENT, LAZY_LOADER_EXPECTED_RUNS, LAZY_NEXT_REVISION } from "./constants.js";

test("a stable lazy component suspends once, reveals, and preserves state", async ({ page }) => {
  await page.goto("/?oracle=lazy-suspense");

  await expect(page.getByTestId("lazy-fallback")).toHaveText("loading lazy content");
  await expect
    .poll(() => page.evaluate(() => window.lazyLoaderRuns))
    .toBe(LAZY_LOADER_EXPECTED_RUNS);
  await expect(page.getByRole("button", { name: "increment lazy count" })).toBeVisible();
  await expect(page.getByTestId("lazy-fallback")).toHaveCount(0);

  await page.getByRole("button", { name: "increment lazy count" }).click();
  await expect(page.getByTestId("lazy-count")).toHaveText(String(LAZY_INCREMENT));
  await page.getByRole("button", { name: "rerender lazy parent" }).click();

  await expect(page.getByTestId("lazy-revision")).toHaveText(String(LAZY_NEXT_REVISION));
  await expect(page.getByTestId("lazy-count")).toHaveText(String(LAZY_INCREMENT));
  await expect
    .poll(() => page.evaluate(() => window.lazyLoaderRuns))
    .toBe(LAZY_LOADER_EXPECTED_RUNS);
});
