import { expect, test } from "@playwright/test";
import { SCHEDULER_SETTLE_WAIT_MS } from "./constants.js";

test("class unmount cancels every Strict Mode timeout generation", async ({ page }) => {
  await page.goto("/?oracle=class-scheduler&mode=safe");
  await page.getByRole("button", { name: "unmount class scheduler" }).click();
  await page.waitForTimeout(SCHEDULER_SETTLE_WAIT_MS);

  expect(await page.evaluate(() => window.classMounts)).toBe(2);
  expect(await page.evaluate(() => window.classUnmounts)).toBe(2);
  expect(await page.evaluate(() => window.classSchedulerHits)).toBe(0);
});

test("missing class cancellation leaves both Strict Mode timeouts live", async ({ page }) => {
  await page.goto("/?oracle=class-scheduler&mode=leaky");
  await page.getByRole("button", { name: "unmount class scheduler" }).click();
  await page.waitForTimeout(SCHEDULER_SETTLE_WAIT_MS);

  expect(await page.evaluate(() => window.classMounts)).toBe(2);
  expect(await page.evaluate(() => window.classUnmounts)).toBe(2);
  expect(await page.evaluate(() => window.classSchedulerHits)).toBe(2);
});
