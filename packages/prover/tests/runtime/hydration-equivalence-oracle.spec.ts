import { expect, test } from "@playwright/test";

test("equivalent server and client trees hydrate without recovery", async ({ page }) => {
  await page.goto("/?oracle=hydration-equivalence&mode=equivalent");

  await expect(page.getByTestId("hydration-content")).toHaveText("Server account");
  await expect(page.locator("body")).not.toHaveAttribute("data-hydration-mismatch");
});

test("different first renders force hydration recovery", async ({ page }) => {
  await page.goto("/?oracle=hydration-equivalence&mode=mismatch");

  await expect(page.getByTestId("hydration-content")).toHaveText("Browser account");
  await expect(page.locator("body")).toHaveAttribute("data-hydration-mismatch", "true");
});
