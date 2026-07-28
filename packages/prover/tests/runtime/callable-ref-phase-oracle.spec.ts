import { expect, test } from "@playwright/test";

test("a layout-synchronized callable ref observes the current commit", async ({ page }) => {
  await page.goto("/?oracle=callable-ref-phase&mode=layout");
  await page.getByRole("button", { name: "advance revision" }).click();

  await expect(page.getByTestId("observed-callback-revision")).toHaveText("1");
});

test("a passive callable-ref update can lag behind an observable commit", async ({ page }) => {
  await page.goto("/?oracle=callable-ref-phase&mode=passive");
  await page.getByRole("button", { name: "advance revision" }).click();

  await expect(page.getByTestId("observed-callback-revision")).toHaveText("0");
});
