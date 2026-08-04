import { expect, test } from "@playwright/test";
import { SCHEDULER_SETTLE_WAIT_MS } from "./constants.js";

test("clearing a timeout during Effect cleanup prevents post-unmount work", async ({ page }) => {
  await page.goto("/?oracle=scheduler-lifetime&mode=cancel");
  await page.getByRole("button", { name: "unmount scheduler" }).click();
  await page.waitForTimeout(SCHEDULER_SETTLE_WAIT_MS);

  expect(await page.evaluate(() => window.schedulerHits)).toBe(0);
});

test("an uncanceled timeout remains observable after Effect cleanup", async ({ page }) => {
  await page.goto("/?oracle=scheduler-lifetime&mode=leak");
  await page.getByRole("button", { name: "unmount scheduler" }).click();
  await page.waitForTimeout(SCHEDULER_SETTLE_WAIT_MS);

  expect(await page.evaluate(() => window.schedulerHits)).toBe(1);
});
