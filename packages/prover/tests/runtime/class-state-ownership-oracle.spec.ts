import { expect, test } from "@playwright/test";

test("direct class state mutation changes the object without scheduling a render", async ({
  page,
}) => {
  await page.goto("/?oracle=class-state-ownership");
  await expect(page.getByTestId("direct-class-state")).toHaveText("0");

  await page.getByRole("button", { name: "mutate class state directly" }).click();

  await expect.poll(() => page.evaluate(() => window.classDirectStateValue)).toBe(1);
  await expect(page.getByTestId("direct-class-state")).toHaveText("0");
});
