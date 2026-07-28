import { expect, test } from "@playwright/test";

test("confirms that an Effect Event reads the latest committed value", async ({ page }) => {
  await page.goto("/?oracle=effect-event&mode=safe");
  await page.getByRole("button", { name: "disable" }).click();
  await page.getByRole("button", { name: "dispatch" }).click();

  await expect(page.getByTestId("effect-event-hits")).toHaveText("0");
});

test("confirms the equivalent ordinary closure observes a stale value", async ({ page }) => {
  await page.goto("/?oracle=effect-event&mode=stale");
  await page.getByRole("button", { name: "disable" }).click();
  await page.getByRole("button", { name: "dispatch" }).click();

  await expect(page.getByTestId("effect-event-hits")).toHaveText("1");
});

test("confirms that Effect Event identity changes after a render", async ({ page }) => {
  await page.goto("/?oracle=effect-event-identity");
  await expect.poll(() => page.evaluate(() => window.effectEventSetupRuns)).toBe(1);
  await page.getByRole("button", { name: "rerender 0" }).click();

  await expect.poll(() => page.evaluate(() => window.effectEventSetupRuns)).toBe(2);
});

test("reproduces the stale-context Effect Event bug through memo", async ({ page }) => {
  await page.goto("/?oracle=effect-event-memo-context");
  await page.getByRole("button", { name: "navigate" }).click();
  await expect(page.getByTestId("rendered-navigation")).toHaveText("REPLACE");
  await page.getByRole("button", { name: "inspect" }).click();

  await expect(page.getByTestId("observed-navigation")).toHaveText("POP");
});
