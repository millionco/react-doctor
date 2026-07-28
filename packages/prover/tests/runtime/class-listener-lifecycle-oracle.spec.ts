import { expect, test } from "@playwright/test";

test("class unmount removes the exact listener through the Strict Mode lifecycle", async ({
  page,
}) => {
  await page.goto("/?oracle=class-listener&mode=safe");
  await page.getByRole("button", { name: "unmount class listener" }).click();
  await page.getByRole("button", { name: "dispatch class event" }).click();

  await expect.poll(() => page.evaluate(() => window.classMounts)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.classUnmounts)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.classListenerHits)).toBe(0);
});

test("missing class teardown leaves the listener live after unmount", async ({ page }) => {
  await page.goto("/?oracle=class-listener&mode=leaky");
  await page.getByRole("button", { name: "unmount class listener" }).click();
  await page.getByRole("button", { name: "dispatch class event" }).click();

  await expect.poll(() => page.evaluate(() => window.classMounts)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.classUnmounts)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.classListenerHits)).toBe(1);
});
