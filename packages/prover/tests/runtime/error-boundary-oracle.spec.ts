import { expect, test } from "@playwright/test";

test("a render failure is contained by its nearest Error Boundary", async ({ page }) => {
  await page.goto("/?oracle=error-boundary");

  await expect(page.getByTestId("error-fallback")).toHaveText("caught");
});

test("a failing boundary fallback escapes to an outer Error Boundary", async ({ page }) => {
  await page.goto("/?oracle=error-boundary&mode=throwing-fallback");

  await expect(page.getByTestId("outer-error-fallback")).toHaveText("outer caught");
  await expect(page.getByTestId("error-fallback")).toHaveCount(0);
});
