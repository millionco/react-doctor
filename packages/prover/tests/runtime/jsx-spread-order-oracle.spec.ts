import { expect, test } from "@playwright/test";

test("confirms that an explicit callback after a spread wins", async ({ page }) => {
  await page.goto("/?oracle=jsx-spread-order&mode=explicit-last");
  await page.getByRole("button", { name: "activate" }).click();

  await expect(page.getByTestId("last-handler")).toHaveText("explicit");
});

test("confirms that a spread callback after an explicit prop wins", async ({ page }) => {
  await page.goto("/?oracle=jsx-spread-order&mode=spread-last");
  await page.getByRole("button", { name: "activate" }).click();

  await expect(page.getByTestId("last-handler")).toHaveText("spread");
});
