import { expect, test } from "@playwright/test";
import { OPTIMISTIC_ACTION_EXPECTED_RUNS } from "./constants.js";

test("an optimistic update remains visible while its Form Action is pending", async ({ page }) => {
  await page.goto("/?oracle=optimistic-form-action");

  await page.getByRole("button", { name: "add todo" }).click();

  await expect(page.getByTestId("optimistic-pending")).toHaveText("true");
  await expect(page.getByTestId("optimistic-todos")).toContainText("Write:pending");
  await expect
    .poll(() => page.evaluate(() => window.optimisticActionRuns))
    .toBe(OPTIMISTIC_ACTION_EXPECTED_RUNS);
  await expect(page.getByTestId("optimistic-pending")).toHaveText("false");
  await expect(page.getByTestId("optimistic-todos")).toContainText("Write:confirmed");
});
