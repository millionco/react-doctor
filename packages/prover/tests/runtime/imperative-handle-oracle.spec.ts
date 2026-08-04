import { expect, test } from "@playwright/test";

test("a complete imperative-handle dependency list exposes current state", async ({ page }) => {
  await page.goto("/?oracle=imperative-handle&mode=safe");
  await page.getByRole("button", { name: "advance label" }).click();
  await page.getByRole("button", { name: "read handle" }).click();

  await expect(page.getByTestId("observed-handle-label")).toHaveText("beta");
});

test("a missing imperative-handle dependency exposes stale state", async ({ page }) => {
  await page.goto("/?oracle=imperative-handle&mode=stale");
  await page.getByRole("button", { name: "advance label" }).click();
  await page.getByRole("button", { name: "read handle" }).click();

  await expect(page.getByTestId("observed-handle-label")).toHaveText("alpha");
});
