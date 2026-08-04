import { expect, test } from "@playwright/test";

test("confirms that a mismatched listener identity survives unmount", async ({ page }) => {
  await page.goto("/?mode=leaky");
  await page.getByRole("button", { name: "unmount" }).click();
  await page.getByRole("button", { name: "dispatch" }).click();

  await expect.poll(() => page.evaluate(() => window.listenerHits)).toBe(1);
});

test("confirms that a symmetric listener cleanup removes the resource", async ({ page }) => {
  await page.goto("/?mode=safe");
  await page.getByRole("button", { name: "unmount" }).click();
  await page.getByRole("button", { name: "dispatch" }).click();

  await expect.poll(() => page.evaluate(() => window.listenerHits)).toBe(0);
});
