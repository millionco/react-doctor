import { expect, test } from "@playwright/test";

test("an equivalent memo comparator exposes the next render", async ({ page }) => {
  await page.goto("/?oracle=memo-equivalence");

  await expect(page.getByTestId("memo-value")).toHaveText("Before");
  await page.getByRole("button", { name: "update label" }).click();
  await expect(page.getByTestId("memo-value")).toHaveText("After");
});

test("a comparator that omits an observed prop preserves stale output", async ({ page }) => {
  await page.goto("/?oracle=memo-equivalence&mode=omitted");

  await expect(page.getByTestId("memo-value")).toHaveText("Before");
  await page.getByRole("button", { name: "update label" }).click();
  await expect(page.getByTestId("memo-value")).toHaveText("Before");
});
