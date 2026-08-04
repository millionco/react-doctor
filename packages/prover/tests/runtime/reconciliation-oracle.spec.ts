import { expect, test } from "@playwright/test";

test("confirms that an index key transfers state to a different item", async ({ page }) => {
  await page.goto("/?oracle=keys&mode=index");
  await page.getByRole("listitem").filter({ hasText: "Alpha" }).getByRole("textbox").fill("typed");
  await page.getByRole("button", { name: "reverse" }).click();

  await expect(
    page.getByRole("listitem").filter({ hasText: "Beta" }).getByRole("textbox"),
  ).toHaveValue("typed");
});

test("confirms that a semantic key preserves state with its item", async ({ page }) => {
  await page.goto("/?oracle=keys&mode=semantic");
  await page.getByRole("listitem").filter({ hasText: "Alpha" }).getByRole("textbox").fill("typed");
  await page.getByRole("button", { name: "reverse" }).click();

  await expect(
    page.getByRole("listitem").filter({ hasText: "Alpha" }).getByRole("textbox"),
  ).toHaveValue("typed");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Beta" }).getByRole("textbox"),
  ).toHaveValue("");
});
