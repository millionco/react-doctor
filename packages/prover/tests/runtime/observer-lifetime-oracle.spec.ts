import { expect, test } from "@playwright/test";
import { OBSERVER_DELIVERY_WAIT_MS } from "./constants.js";

const mutateObservedBody = async (page: import("@playwright/test").Page) => {
  await page.evaluate(() => {
    window.observerHits = 0;
    document.body.append(document.createElement("aside"));
  });
  await page.waitForTimeout(OBSERVER_DELIVERY_WAIT_MS);
};

test("disconnect prevents observer delivery after unmount", async ({ page }) => {
  await page.goto("/?oracle=observer-lifetime&mode=disconnect");
  await page.getByRole("button", { name: "unmount observer" }).click();
  await mutateObservedBody(page);
  expect(await page.evaluate(() => window.observerHits)).toBe(0);
});

test("missing disconnect permits observer delivery after unmount", async ({ page }) => {
  await page.goto("/?oracle=observer-lifetime&mode=leak");
  await page.getByRole("button", { name: "unmount observer" }).click();
  await mutateObservedBody(page);
  await expect.poll(() => page.evaluate(() => window.observerHits)).toBe(1);
});
