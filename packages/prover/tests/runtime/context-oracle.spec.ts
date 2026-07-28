import { expect, test } from "@playwright/test";

test("a consumer receives a provider value only from the same context object", async ({ page }) => {
  await page.goto("/?oracle=context-identity&mode=same");

  await expect(page.getByTestId("context-identity-value")).toHaveText("provided");
});

test("a structurally identical context object still reads its own default", async ({ page }) => {
  await page.goto("/?oracle=context-identity&mode=duplicate");

  await expect(page.getByTestId("context-identity-value")).toHaveText("consumer-default");
});

test("the nearest nested provider isolates its consumer from the parent", async ({ page }) => {
  await page.goto("/?oracle=nested-context&mode=nested");

  await expect(page.getByTestId("outer-context-value")).toHaveText("outer");
  await expect(page.getByTestId("inner-context-value")).toHaveText("inner");
});

test("without a nested provider the inner consumer inherits the parent", async ({ page }) => {
  await page.goto("/?oracle=nested-context&mode=missing");

  await expect(page.getByTestId("outer-context-value")).toHaveText("outer");
  await expect(page.getByTestId("inner-context-value")).toHaveText("outer");
});
