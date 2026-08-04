import { expect, test } from "@playwright/test";
import { TRANSITION_ACTION_EXPECTED_RUNS } from "./constants.js";

test("an async Action stays pending and nests its post-await state Transition", async ({
  page,
}) => {
  await page.goto("/?oracle=transition-action");

  await page.getByRole("button", { name: "show activity" }).click();

  await expect(page.getByTestId("transition-pending")).toHaveText("true");
  await expect
    .poll(() => page.evaluate(() => window.transitionActionRuns))
    .toBe(TRANSITION_ACTION_EXPECTED_RUNS);
  await expect(page.getByTestId("transition-panel")).toHaveText("activity");
  await expect(page.getByTestId("transition-pending")).toHaveText("false");
});
